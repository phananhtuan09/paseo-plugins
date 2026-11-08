import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRows, followState, type RawEntry } from "./timeline-rows.ts";
import { segmentRows } from "./segments.ts";

const call = (status: string, time: number, turnId = "turn-1"): RawEntry => ({
  timestamp: new Date(time).toISOString(), turnId,
  item: { type: "tool_call", callId: "codex-1", name: "shell", status, detail: { type: "shell", command: "sleep 45" } },
});

test("stopped turns freeze unresolved tools and report Stopped rather than a successful completion", () => {
  const rows = buildRows([call("running", 1000)], false);
  assert.equal(rows[0].step?.status, "canceled");
  const segments = segmentRows(rows);
  assert.equal(segments.get("codex-1")?.run?.running, false);
  const follow = followState({ rows, segments, loaded: true, running: false });
  assert.equal(follow.kind, "done");
  if (follow.kind === "done") assert.equal(follow.canceled, 1);
});

test("late Codex completion replaces the running record with one completed step", () => {
  const rows = buildRows([call("running", 1000), call("completed", 46000)], false);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].time, 46000);
  assert.equal(rows[0].step?.status, "done");
  assert.equal(segmentRows(rows).get("codex-1")?.run?.steps, 1);
});

test("stale running snapshots cannot override terminal records", () => {
  const rows = buildRows([call("completed", 46000), call("running", 1000)], true);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].step?.status, "done");
});

test("a new running turn does not restart unresolved tools from an earlier turn", () => {
  const rows = buildRows([call("running", 1000), { timestamp: new Date(2000).toISOString(), turnId: "turn-2", item: { type: "user_message", text: "continue" } }], true);
  assert.equal(rows[0].step?.status, "canceled");
});

test("synthetic agent messages also separate turns without turn IDs", () => {
  const old = { ...call("running", 1000), turnId: undefined };
  const rows = buildRows([old, { timestamp: new Date(2000).toISOString(), item: { type: "tool_call", name: "agent_message", detail: { type: "plain_text", text: "continue" } } }], true);
  assert.equal(rows[0].step?.status, "canceled");
});

test("active tools keep streaming while their turn runs", () => {
  assert.equal(buildRows([call("running", 1000)], true)[0].step?.status, "running");
});

const shell = (callId: string, status: string, time: number, output?: string): RawEntry => ({
  timestamp: new Date(time).toISOString(),
  turnId: "turn-1",
  item: { type: "tool_call", callId, name: "Bash", status, detail: { type: "shell", command: "loop", ...(output ? { output } : {}) } },
});
const notification = (toolUseId: string, time: number, text: string): RawEntry => ({
  timestamp: new Date(time).toISOString(),
  item: { type: "tool_call", callId: `task_notification_${toolUseId}`, name: "task_notification", detail: { type: "plain_text", text }, metadata: { toolUseId } } as never,
});
const MOVED = "Command did not complete within its 120s timeout and was moved to the background (ID: b1). Output is being written to: /tmp/x.";
const none = { waiting: new Set<string>(), approvedAt: new Map<string, number>(), agentClosed: false };

test("a step waiting for a permission request is marked waiting, then counts from the answer", () => {
  const entries = [shell("t1", "running", 5000)];
  assert.equal(buildRows(entries, true, { ...none, waiting: new Set(["t1"]) })[0].live?.kind, "wait");
  const approved = buildRows(entries, true, { ...none, approvedAt: new Map([["t1", 9000]]) })[0].live;
  assert.deepEqual(approved, { kind: "fg", startMs: 9000 });
});

test("a command moved to the background stays running until its notification ends it", () => {
  const entries = [shell("t1", "completed", 125_000, MOVED)];
  const open = buildRows(entries, false)[0];
  assert.equal(open.step?.status, "running");
  assert.deepEqual(open.live, { kind: "bg", startMs: 5000 });
  assert.equal(segmentRows(buildRows(entries, false)).get("t1")?.run?.running, true);

  const ok = buildRows([...entries, notification("t1", 205_000, "Background command completed (exit code 0)")], false);
  assert.equal(ok.length, 1, "the notification row stays hidden");
  assert.equal(ok[0].step?.status, "done");
  assert.deepEqual(ok[0].live, { kind: "bgdone", ok: true, exitCode: 0, totalMs: 200_000 });

  const bad = buildRows([...entries, notification("t1", 205_000, "Background command failed (exit code 2)")], false);
  assert.equal(bad[0].step?.status, "failed");
  assert.equal(bad[0].step?.meta, "exit 2");
});

test("a killed background command ends as failed with its status as the label", () => {
  const killed: RawEntry = { ...notification("t1", 130_000, "stopped"), item: { ...notification("t1", 130_000, "stopped").item, metadata: { toolUseId: "t1", status: "killed" } } as never };
  const rows = buildRows([shell("t1", "completed", 125_000, MOVED), killed], false);
  assert.equal(rows[0].step?.status, "failed");
  assert.equal(rows[0].step?.meta, "killed");
});

test("a background command of a closed agent without a notification is unknown and not running", () => {
  const rows = buildRows([shell("t1", "completed", 125_000, MOVED)], false, { ...none, agentClosed: true });
  assert.equal(rows[0].live?.kind, "unknown");
  assert.equal(rows[0].step?.status, "done");
});

test("two parallel commands keep separate clocks", () => {
  const rows = buildRows([shell("a", "running", 1000), shell("b", "running", 4000)], true);
  assert.deepEqual(rows.map((row) => row.live), [{ kind: "fg", startMs: 1000 }, { kind: "fg", startMs: 4000 }]);
});

test("a normal finished command has no live state", () => {
  assert.equal(buildRows([shell("t1", "completed", 5000, "ok")], false)[0].live, undefined);
});

test("the bare failed record added when an agent is stopped does not replace the canceled step", () => {
  const canceled = shell("t1", "canceled", 5000);
  const stub: RawEntry = { timestamp: new Date(5020).toISOString(), turnId: "turn-1", item: { type: "tool_call", callId: "t1", name: "tool", status: "failed", detail: { type: "unknown", input: null, output: null }, error: { content: "The user doesn't want to proceed" } } };
  const rows = buildRows([canceled, stub], false);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].step?.status, "canceled");
  assert.equal(rows[0].step?.activity, "run");
});
