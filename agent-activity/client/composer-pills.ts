import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { ACTIVITY_META, activityLabel } from "./activity-meta.ts";
import { type FollowState, followState, forgetAgentTimeline, getAgentTimeline } from "./agent-timeline.ts";
import {
  type DetailLevel,
  getDetailLevel,
  nextDetailLevel,
  setDetailLevel,
  subscribeDetailLevel,
} from "./detail-level.ts";
import { formatDuration } from "./format.ts";

const LABELS: Record<DetailLevel, string> = { brief: "Brief", steps: "Steps", full: "Full" };
const TARGET_MAX = 36;

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

const noop = { kind: "action" as const, onPress() {} };

function followButton(state: FollowState, now: number) {
  switch (state.kind) {
    case "step": {
      const { step } = state;
      const target = step.target.length > TARGET_MAX ? `${step.target.slice(0, TARGET_MAX)}…` : step.target;
      const text = `${ACTIVITY_META[step.activity].phase} · ${activityLabel(step.activity, "running")} ${target}`;
      return {
        title: `${text} (${formatDuration(now - state.startMs)})`,
        icon: ACTIVITY_META[step.activity].icon,
        label: `${text} · ${formatDuration(now - state.startMs)}`,
        behavior: noop,
        visible: true,
      };
    }
    case "answering":
      return {
        title: "Answering",
        icon: "MessageSquare",
        label: `Answering · ${formatDuration(now - state.startMs)}`,
        behavior: noop,
        visible: true,
      };
    case "working":
      return { title: "Working", icon: "Loader", label: "Working", behavior: noop, visible: true };
    case "done": {
      const parts = [`${state.steps} step${state.steps === 1 ? "" : "s"}`];
      if (state.failed > 0) parts.push(`${state.failed} failed`);
      parts.push(formatDuration(state.durationMs));
      return {
        title: `Done · ${parts.join(" · ")}`,
        icon: "Check",
        label: `Done · ${parts.join(" · ")}`,
        behavior: noop,
        visible: true,
      };
    }
    case "hidden":
      return { title: "Agent activity", icon: "Activity", label: "Activity", behavior: noop, visible: false };
  }
}

interface AgentPills {
  detail: PluginButtonRegistration;
  follow: PluginButtonRegistration;
  /** Starts watching the agent's timeline; idle agents are not watched until they run. */
  watch: () => void;
  release: () => void;
}

/** Adds the follow and Detail pills to every agent, including agents created later. Returns cleanup. */
export function contributeComposerPills(client: PluginClientContext): () => void {
  const agents = new Map<string, AgentPills>();
  const lifetime = new AbortController();

  const register = (agent: { id: string; workspaceId?: string | null; status?: string }) => {
    if (lifetime.signal.aborted || !agent.workspaceId) return;
    const running = agent.status === "running";
    const existing = agents.get(agent.id);
    if (existing) {
      if (running) existing.watch();
      getAgentTimeline(agent.id).setRunning(running);
      return;
    }
    const { id, workspaceId } = { id: agent.id, workspaceId: agent.workspaceId };
    const store = getAgentTimeline(id);
    let releaseStore: (() => void) | undefined;
    const watch = () => {
      releaseStore ??= store.acquire(client.paseo);
    };
    if (running) watch();
    store.setRunning(running);
    const follow = client.addComposerPill({
      id: "follow",
      workspaceId,
      agentId: id,
      button: followButton(followState(store.state), Date.now()),
    });
    const detail = client.addComposerPill({ id: "detail", workspaceId, agentId: id, button: detailButton() });
    // Elapsed time only changes while something runs, so the timer exists only then.
    let timer: ReturnType<typeof setInterval> | undefined;
    const syncTimer = () => {
      const kind = followState(store.state).kind;
      const ticking = kind === "step" || kind === "answering";
      if (ticking && timer === undefined) timer = setInterval(render, 1000);
      else if (!ticking && timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    };
    const render = () => {
      follow.update(followButton(followState(store.state), Date.now()));
      syncTimer();
    };
    const stopStore = store.subscribe(render);
    syncTimer();
    agents.set(id, {
      detail,
      follow,
      watch,
      release: () => {
        if (timer !== undefined) clearInterval(timer);
        stopStore();
        releaseStore?.();
        follow.remove();
        detail.remove();
        forgetAgentTimeline(id);
      },
    });
  };

  const removeAll = () => {
    for (const pills of agents.values()) pills.release();
    agents.clear();
  };

  const stopLevel = subscribeDetailLevel(() => {
    for (const pills of agents.values()) pills.detail.update(detailButton());
  });

  void client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      subscription.subscribe({
        snapshot: ({ entries }) => {
          // Keep the pills and stores of agents that are still listed; only agents that vanished are released.
          const listed = new Set(entries.map(({ agent }) => agent.id));
          for (const [id, pills] of agents) {
            if (listed.has(id)) continue;
            pills.release();
            agents.delete(id);
          }
          for (const { agent } of entries) register(agent);
        },
        update: (message) => {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "upsert") return register(update.agent);
          agents.get(update.agentId)?.release();
          agents.delete(update.agentId);
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
