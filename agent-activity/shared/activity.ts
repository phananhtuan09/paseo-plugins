import { z } from "zod";

export const ACTIVITIES = [
  "read",
  "edit",
  "write",
  "run",
  "search",
  "web",
  "delegate",
  "plan",
  "tool",
  "think",
] as const;

export const activitySchema = z.enum(ACTIVITIES);
export const statusSchema = z.enum(["running", "done", "failed", "canceled"]);

export const bodyLangSchema = z.enum(["js", "json", "py", "sh", "yaml"]);

export const stepBodySchema = z.object({
  kind: z.enum(["mono", "diff", "stream"]),
  text: z.string(),
  /** Syntax highlighting language of `text`, set only when it is known. */
  lang: bodyLangSchema.optional(),
  hiddenLines: z.number().int().nonnegative().optional(),
});

export const activityStepSchema = z.object({
  /** Tool call id; reasoning has none and is keyed by its timestamp. */
  callId: z.string().optional(),
  activity: activitySchema,
  status: statusSchema,
  target: z.string(),
  meta: z.string().optional(),
  details: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
  /** Full shell command, shown highlighted in the step detail. */
  command: z.string().optional(),
  body: stepBodySchema.optional(),
  errorText: z.string().optional(),
});

export type Activity = z.infer<typeof activitySchema>;
export type StepStatus = z.infer<typeof statusSchema>;
export type BodyLang = z.infer<typeof bodyLangSchema>;
export type StepBody = z.infer<typeof stepBodySchema>;
export type ActivityStep = z.infer<typeof activityStepSchema>;

export const ACTIVITY_STEP_KIND = "activity-step";
export const ACTIVITY_STEP_VERSION = 1;
