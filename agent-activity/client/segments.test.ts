import assert from "node:assert/strict";
import { test } from "node:test";
import { type SegmentRow, segmentRows } from "./segments.ts";

const step = (key: string, activity: any, status: any = "done", time = 0): SegmentRow => ({
  key,
  time,
  step: { activity, status },
});
const other = (key: string): SegmentRow => ({ key, time: 0 });

test("an empty timeline has no segments", () => {
  assert.equal(segmentRows([]).size, 0);
});

test("a run header sits on the first step and counts steps, failures and duration", () => {
  const info = segmentRows([
    step("a", "read", "done", 1000),
    step("b", "edit", "done", 2000),
    step("c", "run", "failed", 5000),
  ]);
  assert.deepEqual(info.get("a")?.run, { steps: 3, failed: 1, startMs: 1000, endMs: 5000, running: false });
  assert.equal(info.get("b")?.run, undefined);
  assert.equal(info.get("c")?.run, undefined);
});

test("phase labels start at the first step of each phase", () => {
  const info = segmentRows([step("a", "think"), step("b", "read"), step("c", "edit"), step("d", "run", "running")]);
  assert.equal(info.get("a")?.phase?.phase, "Explore");
  assert.equal(info.get("b")?.phase, undefined);
  assert.equal(info.get("c")?.phase?.phase, "Change");
  assert.deepEqual(info.get("d")?.phase, { phase: "Verify", running: true, failed: false });
});

test("a failed step marks its phase and the run as failed", () => {
  const info = segmentRows([step("a", "read", "failed"), step("b", "search")]);
  assert.equal(info.get("a")?.phase?.failed, true);
  assert.equal(info.get("a")?.run?.failed, 1);
});

test("an answer between steps starts a new run", () => {
  const info = segmentRows([step("a", "read"), other("msg"), step("b", "read"), step("c", "run")]);
  assert.equal(info.get("a")?.run?.steps, 1);
  assert.equal(info.get("b")?.run?.steps, 2);
  assert.equal(info.get("msg"), undefined);
});

test("the same phase returning after another phase gets a new label", () => {
  const info = segmentRows([step("a", "read"), step("b", "edit"), step("c", "read")]);
  assert.equal(info.get("c")?.phase?.phase, "Explore");
});

test("parallel running tools count as one running run", () => {
  const info = segmentRows([step("a", "run", "running"), step("b", "run", "running"), step("c", "run", "done")]);
  assert.equal(info.get("a")?.run?.running, true);
  assert.equal(info.get("a")?.run?.steps, 3);
});
