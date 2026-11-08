import type { PluginClientContext } from "@getpaseo/plugin/client";
import { usePaseo } from "@getpaseo/plugin/client";
import { useEffect, useSyncExternalStore } from "react";
import { buildRows, type RawEntry, type AgentTimelineState } from "./timeline-rows.ts";
export { stepKey, followState, type FollowState } from "./timeline-rows.ts";
import { type SegmentInfo, segmentRows } from "./segments.ts";

type Paseo = PluginClientContext["paseo"];

const REFETCH_DELAY_MS = 300;
const TAIL_LIMIT = 200;
const NO_SEGMENTS: ReadonlyMap<string, SegmentInfo> = new Map();

class AgentTimelineStore {
  state: AgentTimelineState = { segments: NO_SEGMENTS, rows: [], loaded: false, running: false };
  private readonly listeners = new Set<() => void>();
  private refs = 0;
  private stop: (() => void) | undefined;
  private refetchTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private fetchSeq = 0;
  private entries: readonly RawEntry[] = [];

  constructor(private readonly agentId: string) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): AgentTimelineState => this.state;

  acquire(paseo: Paseo): () => void {
    if (this.refs === 0) {
      try {
        this.start(paseo);
      } catch (error) {
        // A failed start leaves no reference behind, so the next acquire tries again.
        this.shutdown();
        console.error("agent-activity: timeline subscription failed", error);
        return () => {};
      }
    }
    this.refs += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.refs -= 1;
      if (this.refs === 0) this.shutdown();
    };
  }

  setRunning(running: boolean): void {
    if (this.state.running === running) return;
    this.state = { ...this.state, running };
    this.apply(this.entries);
  }

  private start(paseo: Paseo): void {
    this.disposed = false;
    const timeline = paseo.agents.ref(this.agentId).timeline;
    const refetch = () => {
      this.refetchTimer = undefined;
      this.fetchSeq += 1;
      const seq = this.fetchSeq;
      timeline
        .refetch({ direction: "tail", limit: TAIL_LIMIT })
        .then((payload) => {
          // A slower, older response must not overwrite a newer one.
          if (!this.disposed && seq === this.fetchSeq) this.apply(payload.entries as unknown as RawEntry[]);
        })
        .catch(() => {
          // Without a timeline the headers are skipped and each step still renders on its own.
        });
    };
    const schedule = () => {
      if (this.refetchTimer === undefined) this.refetchTimer = setTimeout(refetch, REFETCH_DELAY_MS);
    };
    refetch();
    const subscription = timeline.subscribe((message) => {
      const type = (message as { event?: { type?: string } }).event?.type;
      if (type === "turn_started") this.setRunning(true);
      else if (type?.startsWith("turn_")) this.setRunning(false);
      if (type === "timeline" || type?.startsWith("turn_") || type === "subscription_restored" || type === "replacement") schedule();
    });
    this.stop = subscription;
  }

  private shutdown(): void {
    this.disposed = true;
    if (this.refetchTimer !== undefined) clearTimeout(this.refetchTimer);
    this.refetchTimer = undefined;
    this.stop?.();
    this.stop = undefined;
  }

  private apply(entries: readonly RawEntry[]): void {
    this.entries = entries;
    const rows = buildRows(entries, this.state.running);
    this.state = { ...this.state, rows, loaded: true, segments: segmentRows(rows) };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

const stores = new Map<string, AgentTimelineStore>();

export function getAgentTimeline(agentId: string): AgentTimelineStore {
  let store = stores.get(agentId);
  if (!store) {
    store = new AgentTimelineStore(agentId);
    stores.set(agentId, store);
  }
  return store;
}

export function forgetAgentTimeline(agentId: string): void {
  stores.delete(agentId);
}

/** Shares canonical rows with both Brief chips and expanded views. */
export function useTimelineRow(agentId: string, key: string) {
  const paseo = usePaseo();
  const store = getAgentTimeline(agentId);
  useEffect(() => store.acquire(paseo), [store, paseo]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { row: state.rows.find((row) => row.key === key), info: state.segments.get(key) };
}
