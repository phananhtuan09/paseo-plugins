import type { ActivityStep } from "../shared/activity.ts";

/** What the timeline knows about one step beyond its own record. */
export interface RunningContext {
  /** Timestamp of the step's entry: its start while running, its end once finished. */
  timeMs: number;
  /** `task_notification` that ended a background command. */
  notification?: { timeMs: number; text: string };
  /** The user has not yet answered this step's permission request. */
  waiting: boolean;
  /** When the user answered the permission request, if this client saw it. */
  approvedAtMs?: number;
  /** The agent is closed, so no notification will arrive. */
  agentClosed: boolean;
}

/** How a step that is running, or that ran in the background, is shown. */
export type Live =
  | { kind: "fg"; startMs: number }
  | { kind: "wait" }
  | { kind: "bg"; startMs?: number }
  | { kind: "unknown" }
  | { kind: "bgdone"; ok: boolean; exitCode?: number; totalMs?: number };

/** `undefined` means the step shows exactly what its status says. */
export function deriveRunning(step: ActivityStep, context: RunningContext): Live | undefined {
  if (step.status === "running") {
    if (context.waiting) return { kind: "wait" };
    return { kind: "fg", startMs: context.approvedAtMs ?? context.timeMs };
  }
  const { background } = step;
  if (step.status !== "done" || !background) return undefined;
  // A command moved by its timeout began `timeoutSec` before the move; a requested one began about when it was recorded.
  const startMs =
    background.kind === "requested"
      ? context.timeMs
      : background.timeoutSec !== undefined
        ? context.timeMs - background.timeoutSec * 1000
        : undefined;
  if (context.notification) {
    const code = /\(exit code (\d+)\)/.exec(context.notification.text);
    const exitCode = code ? Number(code[1]) : undefined;
    return {
      kind: "bgdone",
      ok: exitCode === undefined || exitCode === 0,
      ...(exitCode !== undefined ? { exitCode } : {}),
      ...(startMs !== undefined ? { totalMs: Math.max(0, context.notification.timeMs - startMs) } : {}),
    };
  }
  return context.agentClosed ? { kind: "unknown" } : { kind: "bg", ...(startMs !== undefined ? { startMs } : {}) };
}
