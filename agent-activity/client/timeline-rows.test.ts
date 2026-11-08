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
