import { useSyncExternalStore } from "react";
import { readStored, writeStored } from "./web.ts";

export type DetailLevel = "brief" | "steps" | "full";

const LEVELS: readonly DetailLevel[] = ["brief", "steps", "full"];
const STORAGE_KEY = "agent-activity.detail-level";

function isLevel(value: string | null): value is DetailLevel {
  return LEVELS.includes(value as DetailLevel);
}

const stored = readStored(STORAGE_KEY);
let current: DetailLevel = isLevel(stored) ? stored : "brief";
const listeners = new Set<() => void>();

export function getDetailLevel(): DetailLevel {
  return current;
}

export function setDetailLevel(level: DetailLevel): void {
  if (level === current) return;
  current = level;
  writeStored(STORAGE_KEY, level);
  for (const listener of listeners) listener();
}

export function nextDetailLevel(level: DetailLevel): DetailLevel {
  return LEVELS[(LEVELS.indexOf(level) + 1) % LEVELS.length];
}

export function subscribeDetailLevel(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDetailLevel(): DetailLevel {
  return useSyncExternalStore(subscribeDetailLevel, getDetailLevel, getDetailLevel);
}
