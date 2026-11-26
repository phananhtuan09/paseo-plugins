import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActivityStep } from "../shared/activity.ts";
import { deriveRunning, type RunningContext } from "./running.ts";

const base: RunningContext = { timeMs: 100_000, waiting: false, agentClosed: false };
const run = (extra: Partial<ActivityStep>): ActivityStep => ({ activity: "run", status: "done", target: "x", ...extra });
const moved = { id: "b1", kind: "timeout" as const, timeoutSec: 120 };

test("a running step counts from its timestamp", () => {
  assert.deepEqual(deriveRunning(run({ status: "running" }), base), { kind: "fg", startMs: 100_000 });
});

test("a step waiting for approval has no clock, and after approval counts from the answer", () => {
  assert.deepEqual(deriveRunning(run({ status: "running" }), { ...base, waiting: true }), { kind: "wait" });
  assert.deepEqual(deriveRunning(run({ status: "running" }), { ...base, approvedAtMs: 138_000 }), { kind: "fg", startMs: 138_000 });
});

test("steps that finished normally show nothing extra", () => {
  assert.equal(deriveRunning(run({}), base), undefined);
  assert.equal(deriveRunning(run({ status: "failed", meta: "exit 1" }), base), undefined);
  assert.equal(deriveRunning(run({ status: "failed", denied: true }), base), undefined);
  assert.equal(deriveRunning(run({ status: "canceled" }), base), undefined);
});

test("a command moved by its timeout began timeoutSec before the move", () => {
  assert.deepEqual(deriveRunning(run({ background: moved }), base), { kind: "bg", startMs: -20_000 });
});

test("a command moved by a timeout of unknown length has no clock", () => {
  assert.deepEqual(deriveRunning(run({ background: { id: "b1", kind: "timeout" } }), base), { kind: "bg" });
});

test("a requested background command counts from its timestamp", () => {
  assert.deepEqual(deriveRunning(run({ background: { id: "b2", kind: "requested" } }), base), { kind: "bg", startMs: 100_000 });
});

test("the notification ends a background command with its exit code and total time", () => {
  const ok = deriveRunning(run({ background: moved }), { ...base, notification: { timeMs: 202_000, text: 'Background command "x" completed (exit code 0)' } });
  assert.deepEqual(ok, { kind: "bgdone", ok: true, exitCode: 0, totalMs: 222_000 });
  const bad = deriveRunning(run({ background: moved }), { ...base, notification: { timeMs: 202_000, text: "Background command failed (exit code 2)" } });
  assert.deepEqual(bad, { kind: "bgdone", ok: false, exitCode: 2, totalMs: 222_000 });
});

test("a notification without an exit code counts as success", () => {
  const live = deriveRunning(run({ background: { id: "b2", kind: "requested" } }), { ...base, notification: { timeMs: 130_000, text: "done" } });
  assert.deepEqual(live, { kind: "bgdone", ok: true, totalMs: 30_000 });
});

test("a background command of a closed agent without a notification is unknown", () => {
  assert.deepEqual(deriveRunning(run({ background: moved }), { ...base, agentClosed: true }), { kind: "unknown" });
});

test("a notification wins over a closed agent", () => {
  const live = deriveRunning(run({ background: moved }), { ...base, agentClosed: true, notification: { timeMs: 150_000, text: "(exit code 0)" } });
  assert.equal(live?.kind, "bgdone");
});

test("a notification for a killed command is a failure named by its status, even with no exit code", () => {
  const live = deriveRunning(run({ background: moved }), { ...base, notification: { timeMs: 130_000, text: "Background command was stopped", status: "killed" } });
  assert.deepEqual(live, { kind: "bgdone", ok: false, outcome: "killed", totalMs: 150_000 });
});
