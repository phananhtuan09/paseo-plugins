import type { PluginClientContext } from "@getpaseo/plugin/client";
import { classifyReasoning, classifyToolCall, type ClassifyResult } from "./client/classify.ts";
import { contributeComposerPills } from "./client/composer-pills.ts";
import { StepView } from "./client/step-view.tsx";
import { ACTIVITY_STEP_KIND, ACTIVITY_STEP_VERSION, activityStepSchema } from "./shared/activity.ts";

function toResult(step: ClassifyResult) {
  if (step === undefined) return undefined;
  if (step === null) return { items: [] };
  return { items: [{ type: "plugin" as const, kind: ACTIVITY_STEP_KIND, version: ACTIVITY_STEP_VERSION, data: step }] };
}

export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addTimelineTransformer({
      id: "activity-tool",
      query: { itemType: "tool_call" },
      transform: ({ item, phase }) => toResult(classifyToolCall(item, phase)),
    }),
    client.addTimelineTransformer({
      id: "activity-think",
      query: { itemType: "reasoning" },
      transform: ({ item, phase }) => toResult(classifyReasoning(item, phase)),
    }),
    client.addTimelineRenderer({
      kind: ACTIVITY_STEP_KIND,
      version: ACTIVITY_STEP_VERSION,
      schema: activityStepSchema,
      Component: StepView,
    }),
  ];
  const stopPills = contributeComposerPills(client);
  return () => {
    stopPills();
    for (const remove of removers) remove();
  };
}
