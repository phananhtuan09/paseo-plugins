import type { PluginClientContext } from "@getpaseo/plugin/client";

// Milestone 1 ships only the pure foundation (shared/activity.ts, client/classify.ts).
// Transformers, the renderer and the composer pills register here from milestone 2.
export default function contribute(_client: PluginClientContext) {
  return () => {};
}
