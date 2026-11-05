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

export const stepBodySchema = z.object({
  kind: z.enum(["mono", "diff", "stream"]),
  text: z.string(),
  hiddenLines: z.number().int().nonnegative().optional(),
});

export const activityStepSchema = z.object({
  activity: activitySchema,
  status: statusSchema,
  target: z.string(),
  meta: z.string().optional(),
  details: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
  body: stepBodySchema.optional(),
  errorText: z.string().optional(),
});

export type Activity = z.infer<typeof activitySchema>;
export type StepStatus = z.infer<typeof statusSchema>;
export type StepBody = z.infer<typeof stepBodySchema>;
export type ActivityStep = z.infer<typeof activityStepSchema>;

export const ACTIVITY_STEP_KIND = "activity-step";
export const ACTIVITY_STEP_VERSION = 1;
