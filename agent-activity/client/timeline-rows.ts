import type { ActivityStep } from "../shared/activity.ts";
import { classifyReasoning, classifyToolCall } from "./classify.ts";
import { deriveRunning, type Live } from "./running.ts";
import { type SegmentInfo, type SegmentRow, rowStartMs } from "./segments.ts";

/** Key that links a rendered step to its row: tool call id, or the activity and timestamp when there is none. */
export function stepKey(step: Pick<ActivityStep, "callId" | "activity">, timestamp: Date | string): string {
  if (step.callId) return step.callId;
  const ms = typeof timestamp === "string" ? Date.parse(timestamp) : timestamp.getTime();
  return `${step.activity}:${ms}`;
}

interface TimelineRow extends SegmentRow {
  kind: "user" | "assistant" | "step" | "other";
  turnId?: string;
  step?: ActivityStep;
  /** Set for a running step and for a command that ran in the background. */
  live?: Live;
}

/** What the store knows about permissions and the agent; none of it is in the timeline entries. */
export interface RowContext {
  /** Tool call ids whose permission request is unanswered. */
  waiting: ReadonlySet<string>;
  /** When this client saw the user answer, by tool call id. */
  approvedAt: ReadonlyMap<string, number>;
  agentClosed: boolean;
}

const NO_CONTEXT: RowContext = { waiting: new Set(), approvedAt: new Map(), agentClosed: false };

export interface AgentTimelineState {
  segments: ReadonlyMap<string, SegmentInfo>;
  rows: readonly TimelineRow[];
  loaded: boolean;
  running: boolean;
}

export interface RawEntry {
  turnId?: string;
  item: { type: string; [key: string]: unknown };
  timestamp: string;
}

export function buildRows(entries: readonly RawEntry[], turnRunning: boolean, context: RowContext = NO_CONTEXT): TimelineRow[] {
  const rows: TimelineRow[] = [];
  const notifications = notificationsByCall(entries);
  let before: number | undefined;
  const latest = new Map<string, number>();
  let activeStart = 0;
  for (const [index, { item }] of entries.entries()) {
    if (item.type === "user_message" || item.name === "agent_message") activeStart = index;
    if (item.type !== "tool_call" || typeof item.callId !== "string") continue;
    const previous = latest.get(item.callId);
    // A terminal record wins over a stale running snapshot, even if delivered later.
    if (previous === undefined || item.status !== "running" || entries[previous].item.status === "running") latest.set(item.callId, index);
  }
  const activeTurn = entries[entries.length - 1]?.turnId;
  for (const [index, entry] of entries.entries()) {
    if (entry.item.type === "tool_call" && typeof entry.item.callId === "string" && latest.get(entry.item.callId) !== index) continue;
    const time = Date.parse(entry.timestamp);
    const previous = before;
    before = time;
    const item = entry.item as never as { type: string; status?: string };
    let result: ActivityStep | null | undefined;
    if (item.type === "tool_call") {
      const active = turnRunning && (entry.turnId && activeTurn ? entry.turnId === activeTurn : index >= activeStart);
      const normalized = item.status === "running" && !active ? { ...item, status: "canceled" } : item;
      result = classifyToolCall(normalized as never, normalized.status === "running" ? "streaming" : "complete");
    } else if (item.type === "reasoning") {
      // Reasoning is complete once a later row exists; the last row is still streaming while the turn runs.
      result = classifyReasoning(item as never, turnRunning && index === entries.length - 1 ? "streaming" : "complete");
    }
    if (result === null) continue; // hidden rows render nothing
    if (result) {
      const callId = result.callId;
      const live = deriveRunning(result, {
        timeMs: time,
        notification: callId ? notifications.get(callId) : undefined,
        waiting: callId !== undefined && context.waiting.has(callId),
        approvedAtMs: callId ? context.approvedAt.get(callId) : undefined,
        agentClosed: context.agentClosed,
      });
      const step = live ? withLive(result, live) : result;
      rows.push({ key: stepKey(result, entry.timestamp), time, kind: "step", step, live, before: previous, turnId: entry.turnId });
    } else {
      const kind = (item.type === "user_message" || entry.item.name === "agent_message") ? "user" : item.type === "assistant_message" ? "assistant" : "other";
      rows.push({ key: `${kind}:${time}:${rows.length}`, time, kind, before: previous, turnId: entry.turnId });
    }
  }
  return rows;
}

/** A command in the background is still running, and one that ended there takes the outcome its notification reports. */
function withLive(step: ActivityStep, live: Live): ActivityStep {
  if (live.kind === "bg") return { ...step, status: "running" };
  if (live.kind !== "bgdone") return step;
  if (live.ok) return step;
  return { ...step, status: "failed", meta: live.exitCode !== undefined ? `exit ${live.exitCode}` : "failed" };
}

/** `task_notification` entries are hidden, but they end background commands; they link to their step by `metadata.toolUseId`. */
function notificationsByCall(entries: readonly RawEntry[]): Map<string, { timeMs: number; text: string }> {
  const result = new Map<string, { timeMs: number; text: string }>();
  for (const entry of entries) {
    const item = entry.item as { type: string; name?: unknown; detail?: { text?: unknown }; metadata?: { toolUseId?: unknown } };
    if (item.type !== "tool_call" || item.name !== "task_notification") continue;
    const toolUseId = item.metadata?.toolUseId;
    if (typeof toolUseId !== "string") continue;
    result.set(toolUseId, { timeMs: Date.parse(entry.timestamp), text: typeof item.detail?.text === "string" ? item.detail.text : "" });
  }
  return result;
}

export type FollowState =
  | { kind: "step"; step: ActivityStep; startMs: number }
  | { kind: "answering"; startMs: number }
  | { kind: "working" }
  | { kind: "done"; steps: number; failed: number; canceled: number; durationMs: number }
  | { kind: "hidden" };

/** Rows of the latest turn: same `turnId` as the last row, else everything after the last user message. */
function currentTurn(rows: readonly TimelineRow[]): readonly TimelineRow[] {
  const last = rows[rows.length - 1];
  if (last?.turnId) return rows.filter((row) => row.turnId === last.turnId);
  let start = rows.length - 1;
  while (start >= 0 && rows[start].kind !== "user") start -= 1;
  return rows.slice(start + 1);
}

/** What the agent is doing now, from the rows of its current turn. */
export function followState(state: AgentTimelineState): FollowState {
  const { rows } = state;
  const turn = currentTurn(rows);
  if (state.running) {
    const running = turn.filter((row) => row.step?.status === "running");
    const latest = running[running.length - 1];
    if (latest?.step) return { kind: "step", step: latest.step, startMs: latest.time };
    const last = turn[turn.length - 1];
    if (last?.kind === "assistant") return { kind: "answering", startMs: last.time };
    return { kind: "working" };
  }
  const steps = turn.filter((row) => row.step);
  if (!state.loaded || steps.length === 0) return { kind: "hidden" };
  const first = rowStartMs(turn[0]);
  const last = turn[turn.length - 1].time;
  return {
    kind: "done",
    steps: steps.length,
    failed: steps.filter((row) => row.step?.status === "failed").length,
    canceled: steps.filter((row) => row.step?.status === "canceled").length,
    durationMs: Math.max(0, last - first),
  };
}
