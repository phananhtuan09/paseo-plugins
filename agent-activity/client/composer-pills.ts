import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import {
  type DetailLevel,
  getDetailLevel,
  nextDetailLevel,
  setDetailLevel,
  subscribeDetailLevel,
} from "./detail-level.ts";

const LABELS: Record<DetailLevel, string> = { brief: "Brief", steps: "Steps", full: "Full" };

function detailButton() {
  const level = getDetailLevel();
  return {
    title: `Detail level: ${LABELS[level]}. Tap to switch.`,
    icon: "ListTree",
    label: `Detail · ${LABELS[level]}`,
    behavior: {
      kind: "action" as const,
      onPress() {
        setDetailLevel(nextDetailLevel(getDetailLevel()));
      },
    },
  };
}

/** Adds the Detail pill to every agent, including agents created later. Returns cleanup. */
export function contributeComposerPills(client: PluginClientContext): () => void {
  const pills = new Map<string, PluginButtonRegistration>();
  const lifetime = new AbortController();

  const register = (agent: { id: string; workspaceId?: string | null }) => {
    if (lifetime.signal.aborted || !agent.workspaceId || pills.has(agent.id)) return;
    pills.set(
      agent.id,
      client.addComposerPill({
        id: "detail",
        workspaceId: agent.workspaceId,
        agentId: agent.id,
        button: detailButton(),
      }),
    );
  };
  const removeAll = () => {
    for (const pill of pills.values()) pill.remove();
    pills.clear();
  };

  const stopLevel = subscribeDetailLevel(() => {
    for (const pill of pills.values()) pill.update(detailButton());
  });

  void client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      subscription.subscribe({
        snapshot: ({ entries }) => {
          removeAll();
          for (const { agent } of entries) register(agent);
        },
        update: (message) => {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "upsert") return register(update.agent);
          pills.get(update.agentId)?.remove();
          pills.delete(update.agentId);
        },
      });
      return undefined;
    })
    .catch((error) => {
      if (!lifetime.signal.aborted) console.error("agent-activity: agent observation failed", error);
    });

  return () => {
    lifetime.abort();
    stopLevel();
    removeAll();
  };
}
