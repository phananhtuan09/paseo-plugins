import { useSyncExternalStore } from "react";

// This plugin typechecks without the DOM library. Declare only what this module uses.
declare const document:
  | { hidden: boolean; addEventListener(type: string, listener: () => void): void; removeEventListener(type: string, listener: () => void): void }
  | undefined;

const listeners = new Set<() => void>();
let now = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;

function tick(): void {
  now = Date.now();
  for (const listener of listeners) listener();
}

function onVisibility(): void {
  if (typeof document !== "undefined" && document.hidden) stopTimer();
  else if (listeners.size > 0) {
    tick();
    startTimer();
  }
}

function startTimer(): void {
  if (timer === undefined && !(typeof document !== "undefined" && document.hidden)) timer = setInterval(tick, 1000);
}

function stopTimer(): void {
  if (timer !== undefined) clearInterval(timer);
  timer = undefined;
}

/** One interval serves every running step; it pauses while the tab is hidden and catches up when it returns. */
function subscribe(listener: () => void): () => void {
  if (listeners.size === 0 && typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
  listeners.add(listener);
  if (listeners.size === 1) tick();
  startTimer();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopTimer();
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
    }
  };
}

const idle = () => () => {};
const getNow = () => now;

/** Current time, refreshed every second while `active`; an inactive caller does not wake the clock. */
export function useClock(active: boolean): number {
  return useSyncExternalStore(active ? subscribe : idle, getNow, getNow);
}
