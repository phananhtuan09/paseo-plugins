import { ACTIVITY_META, type Phase } from "./activity-meta.ts";
import type { Activity, StepStatus } from "../shared/activity.ts";

/** One timeline row in order. `step` is set only for rows the plugin renders. */
export interface SegmentRow {
  key: string;
  time: number;
  /** Time of the entry right before this row, hidden entries included; a finished step's own time is when it ended. */
  before?: number;
  step?: { activity: Activity; status: StepStatus };
}

/** When a row's work began: a finished step is stamped at its end, so it began when the entry before it did. */
export function rowStartMs(row: SegmentRow): number {
  return row.step ? (row.before ?? row.time) : row.time;
}

export interface RunInfo {
  steps: number;
  failed: number;
  startMs: number;
  endMs: number;
  running: boolean;
}

export interface PhaseInfo {
  phase: Phase;
  running: boolean;
  failed: boolean;
}

/** Header data for a step: `run` on the first step of a run, `phase` on the first step of a phase. */
export interface SegmentInfo {
  run?: RunInfo;
  phase?: PhaseInfo;
}

/**
 * A run is a chain of consecutive plugin-rendered steps, broken by any other row.
 * A phase is a chain of consecutive steps of the same phase inside a run.
 */
export function segmentRows(rows: readonly SegmentRow[]): Map<string, SegmentInfo> {
  const result = new Map<string, SegmentInfo>();
  let index = 0;
  while (index < rows.length) {
    if (!rows[index].step) {
      index += 1;
      continue;
    }
    let end = index;
    while (end + 1 < rows.length && rows[end + 1].step) end += 1;
    markRun(rows.slice(index, end + 1), rows[end + 1], result);
    index = end + 1;
  }
  return result;
}

function markRun(run: readonly SegmentRow[], next: SegmentRow | undefined, result: Map<string, SegmentInfo>): void {
  const steps = run.map((row) => row.step!);
  result.set(run[0].key, {
    run: {
      steps: run.length,
      failed: steps.filter((step) => step.status === "failed").length,
      startMs: rowStartMs(run[0]),
      // The row after the run starts once its last step ended.
      endMs: next?.time ?? run[run.length - 1].time,
      running: steps.some((step) => step.status === "running"),
    },
  });
  let start = 0;
  while (start < run.length) {
    const phase = ACTIVITY_META[steps[start].activity].phase;
    let end = start;
    while (end + 1 < run.length && ACTIVITY_META[steps[end + 1].activity].phase === phase) end += 1;
    const group = steps.slice(start, end + 1);
    const info = result.get(run[start].key) ?? {};
    info.phase = {
      phase,
      running: group.some((step) => step.status === "running"),
      failed: group.some((step) => step.status === "failed"),
    };
    result.set(run[start].key, info);
    start = end + 1;
  }
}
