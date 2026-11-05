import type { PluginClientContext } from "@getpaseo/plugin/client";
import { usePaseo } from "@getpaseo/plugin/client";
import { useEffect, useSyncExternalStore } from "react";
import type { ActivityStep } from "../shared/activity.ts";
import { classifyReasoning, classifyToolCall } from "./classify.ts";
import { type SegmentInfo, type SegmentRow, rowStartMs, segmentRows } from "./segments.ts";

type Paseo = PluginClientContext["paseo"];

const REFETCH_DELAY_MS = 300;
const TAIL_LIMIT = 200;
const NO_SEGMENTS: ReadonlyMap<string, SegmentInfo> = new Map();

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
}

export interface AgentTimelineState {
  segments: ReadonlyMap<string, SegmentInfo>;
  rows: readonly TimelineRow[];
  loaded: boolean;
  running: boolean;
}

class AgentTimelineStore {
  state: AgentTimelineState = { segments: NO_SEGMENTS, rows: [], loaded: false, running: false };
  private readonly listeners = new Set<() => void>();
  private refs = 0;
  private stop: (() => void) | undefined;
  private refetchTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private fetchSeq = 0;

  constructor(private readonly agentId: string) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): AgentTimelineState => this.state;

  acquire(paseo: Paseo): () => void {
    if (this.refs === 0) {
      try {
        this.start(paseo);
      } catch (error) {
        // A failed start leaves no reference behind, so the next acquire tries again.
        this.shutdown();
        console.error("agent-activity: timeline subscription failed", error);
        return () => {};
      }
    }
    this.refs += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.refs -= 1;
      if (this.refs === 0) this.shutdown();
    };
  }

  setRunning(running: boolean): void {
    if (this.state.running === running) return;
    this.state = { ...this.state, running };
    this.emit();
  }

  private start(paseo: Paseo): void {
    this.disposed = false;
    const timeline = paseo.agents.ref(this.agentId).timeline;
    const refetch = () => {
      this.refetchTimer = undefined;
      this.fetchSeq += 1;
      const seq = this.fetchSeq;
      timeline
        .refetch({ direction: "tail", limit: TAIL_LIMIT })
        .then((payload) => {
          // A slower, older response must not overwrite a newer one.
          if (!this.disposed && seq === this.fetchSeq) this.apply(payload.entries as unknown as RawEntry[]);
        })
        .catch(() => {
          // Without a timeline the headers are skipped and each step still renders on its own.
        });
    };
    const schedule = () => {
      if (this.refetchTimer === undefined) this.refetchTimer = setTimeout(refetch, REFETCH_DELAY_MS);
    };
    refetch();
    const subscription = timeline.subscribe((message) => {
      const type = (message as { event?: { type?: string } }).event?.type;
      if (type === "turn_started") this.setRunning(true);
      else if (type?.startsWith("turn_")) this.setRunning(false);
      if (type === "timeline" || type?.startsWith("turn_") || type === "subscription_restored") schedule();
    });
    this.stop = () => {
      try {
        (subscription as unknown as () => void)();
      } catch {
        // Already released by the client.
      }
    };
  }

  private shutdown(): void {
    this.disposed = true;
    if (this.refetchTimer !== undefined) clearTimeout(this.refetchTimer);
    this.refetchTimer = undefined;
    this.stop?.();
    this.stop = undefined;
  }

  private apply(entries: readonly RawEntry[]): void {
    const rows = buildRows(entries, this.state.running);
    this.state = { ...this.state, rows, loaded: true, segments: segmentRows(rows) };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

interface RawEntry {
  turnId?: string;
  item: { type: string; [key: string]: unknown };
  timestamp: string;
}

function buildRows(entries: readonly RawEntry[], turnRunning: boolean): TimelineRow[] {
  const rows: TimelineRow[] = [];
  let before: number | undefined;
  for (const [index, entry] of entries.entries()) {
    const time = Date.parse(entry.timestamp);
    const previous = before;
    before = time;
    const item = entry.item as never as { type: string; status?: string };
    let result: ActivityStep | null | undefined;
    if (item.type === "tool_call") {
      result = classifyToolCall(item as never, item.status === "running" ? "streaming" : "complete");
    } else if (item.type === "reasoning") {
      // Reasoning is complete once a later row exists; the last row is still streaming while the turn runs.
      result = classifyReasoning(item as never, turnRunning && index === entries.length - 1 ? "streaming" : "complete");
    }
    if (result === null) continue; // hidden rows render nothing
    if (result) {
      rows.push({ key: stepKey(result, entry.timestamp), time, kind: "step", step: result, before: previous, turnId: entry.turnId });
    } else {
      const kind = item.type === "user_message" ? "user" : item.type === "assistant_message" ? "assistant" : "other";
      rows.push({ key: `${kind}:${time}:${rows.length}`, time, kind, before: previous, turnId: entry.turnId });
    }
  }
  return rows;
}

const stores = new Map<string, AgentTimelineStore>();

export function getAgentTimeline(agentId: string): AgentTimelineStore {
  let store = stores.get(agentId);
  if (!store) {
    store = new AgentTimelineStore(agentId);
    stores.set(agentId, store);
  }
  return store;
}

export function forgetAgentTimeline(agentId: string): void {
  stores.delete(agentId);
}

const EMPTY: AgentTimelineState = { segments: NO_SEGMENTS, rows: [], loaded: false, running: false };
const noopSubscribe = () => () => {};

/** Run and phase header data for one step, or undefined while disabled or not loaded. */
export function useSegmentInfo(agentId: string, key: string, enabled: boolean): SegmentInfo | undefined {
  const paseo = usePaseo();
  // No store is created while the level shows no headers, so unwatched agents leave nothing behind.
  const store = enabled ? getAgentTimeline(agentId) : undefined;
  useEffect(() => store?.acquire(paseo), [store, paseo]);
  const state = useSyncExternalStore(
    store ? store.subscribe : noopSubscribe,
    store ? store.getSnapshot : () => EMPTY,
    store ? store.getSnapshot : () => EMPTY,
  );
  return state.segments.get(key);
}

export type FollowState =
  | { kind: "step"; step: ActivityStep; startMs: number }
  | { kind: "answering"; startMs: number }
  | { kind: "working" }
  | { kind: "done"; steps: number; failed: number; durationMs: number }
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
    durationMs: Math.max(0, last - first),
  };
}
