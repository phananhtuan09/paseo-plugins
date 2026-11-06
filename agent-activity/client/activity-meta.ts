import type { Activity, StepStatus } from "../shared/activity.ts";

export type Phase = "Explore" | "Change" | "Verify";

interface ActivityMeta {
  /** Label while the step is running. */
  present: string;
  /** Label once the step is done, failed or canceled. */
  past: string;
  /** Lucide icon name. */
  icon: string;
  phase: Phase;
}

export const ACTIVITY_META: Record<Activity, ActivityMeta> = {
  read: { present: "Reading", past: "Read", icon: "FileText", phase: "Explore" },
  edit: { present: "Editing", past: "Edited", icon: "FilePen", phase: "Change" },
  write: { present: "Writing", past: "Wrote", icon: "FilePlus", phase: "Change" },
  run: { present: "Running", past: "Ran", icon: "SquareTerminal", phase: "Verify" },
  search: { present: "Searching", past: "Searched", icon: "Search", phase: "Explore" },
  web: { present: "Fetching", past: "Fetched", icon: "Globe", phase: "Explore" },
  delegate: { present: "Delegating", past: "Delegated", icon: "Bot", phase: "Explore" },
  plan: { present: "Planning", past: "Planned", icon: "ListChecks", phase: "Explore" },
  tool: { present: "Calling", past: "Called", icon: "Wrench", phase: "Explore" },
  think: { present: "Thinking", past: "Thought", icon: "Brain", phase: "Explore" },
};

export function activityLabel(activity: Activity, status: StepStatus): string {
  const meta = ACTIVITY_META[activity];
  return status === "running" ? meta.present : meta.past;
}
