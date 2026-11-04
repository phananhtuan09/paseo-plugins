import type {
  PluginButtonIconProps,
  PluginButtonRegistration,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { ComponentType } from "react";
import { ompUsage } from "./shared/omp-usage";

type UsageResult = Awaited<ReturnType<PluginClientContext["paseo"]["providers"]["listUsage"]>>;
type ProviderUsage = UsageResult["providers"][number];

type OmpWindows = Awaited<ReturnType<typeof readOmp>>["windows"];
const readOmp = (client: PluginClientContext, model: string) => client.rpc(ompUsage, { model });

type Agent = Awaited<ReturnType<PluginClientContext["paseo"]["agents"]["list"]>>["entries"][number]["agent"];

const REFRESH_MS = 60_000;

type Level = "ok" | "warning" | "danger";

// Rounded so the level always matches the percentage shown in the label.
function levelOf(rawPct: number): Level {
  const pct = Math.round(rawPct);
  if (pct >= 90) return "danger";
  if (pct >= 70) return "warning";
  return "ok";
}

const LEVEL_COLOR = { ok: "statusSuccess", warning: "statusWarning", danger: "statusDanger" } as const;
const icons = new Map<string, ComponentType<PluginButtonIconProps>>();

// Only the icon is tinted by usage level; the pill chrome and label stay host-styled.
function levelIcon(name: string, level: Level) {
  const key = `${name}:${level}`;
  let component = icons.get(key);
  if (!component) {
    component = ({ size, theme }: PluginButtonIconProps) => (
      <Icon name={name} size={size} color={theme.colors[LEVEL_COLOR[level]]} />
    );
    icons.set(key, component);
  }
  return component;
}

function findUsage(usage: UsageResult | null, provider: string) {
  const key = provider.toLowerCase();
  return usage?.providers.find(
    (entry) => entry.providerId.toLowerCase() === key || entry.displayName.toLowerCase() === key,
  );
}

function formatReset(resetsAt: string | null | undefined) {
  if (!resetsAt) return "";
  const minutes = Math.max(0, Math.floor((Date.parse(resetsAt) - Date.now()) / 60_000));
  if (minutes < 60) return ` · resets ${minutes}m`;
  return ` · resets ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

type UsageWindow = { label: string; usedPct: number; resetsAt?: string | null };

function describeWindows(name: string, heading: string, windows: UsageWindow[]) {
  if (windows.length === 0) return null;
  return {
    icon: levelIcon("Timer", levelOf(Math.max(...windows.map((window) => window.usedPct)))),
    // Paseo truncates pill labels at a fixed width, so keep the label compact and put details in the tooltip.
    label: `${name} ${windows.map((window) => `${Math.round(window.usedPct)}%`).join("/")}`,
    title: [
      heading,
      ...windows.map(
        (window) => `${window.label}: ${Math.round(window.usedPct)}%${formatReset(window.resetsAt)}`,
      ),
    ].join("\n"),
  };
}

function describe(entry: ProviderUsage | undefined) {
  if (!entry || entry.status !== "available") return null;
  return describeWindows(
    // Personal accounts append the email to displayName, so drop any "(...)" suffix from the pill label.
    entry.displayName.replace(/\s*\(.*\)\s*$/, ""),
    entry.planLabel ? `${entry.displayName} (${entry.planLabel})` : entry.displayName,
    entry.windows.flatMap((window) =>
      window.usedPct == null ? [] : [{ ...window, usedPct: window.usedPct }],
    ),
  );
}

// OMP has no Paseo usage report; its quota belongs to the provider of the model it runs.
function describeOmp(model: string | null | undefined, windows: OmpWindows | undefined) {
  if (!model || !windows) return null;
  return describeWindows("OMP", `OMP · ${model}`, windows);
}

function formatTokens(tokens: number) {
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : `${tokens}`;
}

function describeContext(usage: Agent["lastUsage"]) {
  const used = usage?.contextWindowUsedTokens;
  const max = usage?.contextWindowMaxTokens;
  if (used == null || !max) return null;
  const pct = (used / max) * 100;
  return {
    icon: levelIcon("Layers", levelOf(pct)),
    label: `Ctx ${Math.round(pct)}%`,
    title: `Context window: ${formatTokens(used)} / ${formatTokens(max)} tokens`,
  };
}

type PillInfo = { icon: ComponentType<PluginButtonIconProps>; label: string; title: string } | null;
type TrackedPill = { registration: PluginButtonRegistration; shown?: string };

// Skip host updates when the rendered content has not changed.
function show(pill: TrackedPill, info: PillInfo) {
  const key = info ? `${info.label}\n${info.title}` : "";
  if (pill.shown === key) return;
  pill.shown = key;
  pill.registration.update(info ? { visible: true, ...info } : { visible: false });
}

export default function contribute(client: PluginClientContext) {
  type Entry = { provider: string; model?: string | null; usage: TrackedPill; context: TrackedPill };
  const pills = new Map<string, Entry>();
  const lifetime = new AbortController();
  let usage: UsageResult | null = null;
  const omp = new Map<string, OmpWindows>();
  let stopped = false;

  const usageInfo = (entry: Entry) =>
    entry.provider === "omp"
      ? describeOmp(entry.model, entry.model ? omp.get(entry.model) : undefined)
      : describe(findUsage(usage, entry.provider));

  const showAll = () => {
    if (stopped) return;
    for (const entry of pills.values()) show(entry.usage, usageInfo(entry));
  };

  const refreshOmp = async (model: string) => {
    try {
      omp.set(model, (await readOmp(client, model)).windows);
    } catch (error) {
      console.error("[usage-pill] omp usage failed", error);
      return;
    }
    showAll();
  };

  const refresh = async () => {
    const models = new Set<string>();
    for (const entry of pills.values()) if (entry.provider === "omp" && entry.model) models.add(entry.model);
    for (const model of models) void refreshOmp(model);
    try {
      usage = await client.paseo.providers.listUsage();
    } catch (error) {
      console.error("[usage-pill] listUsage failed", error);
      return;
    }
    showAll();
  };

  const register = (agent: Agent) => {
    if (stopped) return;
    if (!agent.workspaceId || agent.archivedAt) return remove(agent.id);
    let entry = pills.get(agent.id);
    if (entry && entry.provider !== agent.provider) {
      remove(agent.id);
      entry = undefined;
    }
    if (!entry) {
      const pill = client.addComposerPill({
        id: "usage",
        workspaceId: agent.workspaceId,
        agentId: agent.id,
        button: {
          title: "Provider usage",
          icon: "Timer",
          visible: false,
          behavior: { kind: "action", onPress: refresh },
        },
      });
      const contextPill = client.addComposerPill({
        id: "context",
        workspaceId: agent.workspaceId,
        agentId: agent.id,
        button: {
          title: "Context window",
          icon: "Layers",
          visible: false,
          behavior: { kind: "action", onPress: () => {} },
        },
      });
      entry = {
        provider: agent.provider,
        usage: { registration: pill },
        context: { registration: contextPill },
      };
      pills.set(agent.id, entry);
    }
    if (entry.model !== agent.model) {
      entry.model = agent.model;
      if (entry.provider === "omp" && entry.model && !omp.has(entry.model)) void refreshOmp(entry.model);
    }
    show(entry.usage, usageInfo(entry));
    show(entry.context, describeContext(agent.lastUsage));
  };

  const remove = (agentId: string) => {
    const entry = pills.get(agentId);
    entry?.usage.registration.remove();
    entry?.context.registration.remove();
    pills.delete(agentId);
  };

  void client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      subscription.subscribe({
        snapshot: ({ entries }) => {
          const ids = new Set(entries.map(({ agent }) => agent.id));
          for (const agentId of [...pills.keys()]) if (!ids.has(agentId)) remove(agentId);
          for (const { agent } of entries) register(agent);
        },
        update: (message) => {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "remove") remove(update.agentId);
          else register(update.agent);
        },
      });
    })
    .catch((error) => {
      if (!stopped) console.error("[usage-pill] agent observation failed", error);
    });

  void refresh();
  const timer = setInterval(refresh, REFRESH_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
    lifetime.abort();
    for (const agentId of [...pills.keys()]) remove(agentId);
  };
}
