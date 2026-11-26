import assert from "node:assert/strict";
import { test } from "node:test";
import { PermissionTracker } from "./permissions.ts";

const requested = (id: string, toolUseId: unknown) => ({ type: "permission_requested", request: { id, metadata: { toolUseId } } });
const resolved = (requestId: string, behavior: string) => ({ type: "permission_resolved", requestId, resolution: { behavior } });

test("a request marks its tool call waiting, and an allow ends the wait and records the approval time", () => {
  const tracker = new PermissionTracker();
  tracker.onEvent(requested("r1", "t1"), 1000);
  assert.deepEqual([...tracker.waiting], ["t1"]);
  tracker.onEvent(resolved("r1", "allow"), 4000);
  assert.equal(tracker.waiting.size, 0);
  assert.equal(tracker.approvedAt.get("t1"), 4000);
});

test("a denial ends the wait without an approval time", () => {
  const tracker = new PermissionTracker();
  tracker.onEvent(requested("r1", "t1"), 1000);
  tracker.onEvent(resolved("r1", "deny"), 2000);
  assert.equal(tracker.waiting.size, 0);
  assert.equal(tracker.approvedAt.size, 0);
});

test("a request without a tool call id, and a resolution for an unknown request, change nothing", () => {
  const tracker = new PermissionTracker();
  tracker.onEvent(requested("r1", undefined), 1000);
  tracker.onEvent(resolved("unknown", "allow"), 2000);
  assert.equal(tracker.waiting.size, 0);
  assert.equal(tracker.approvedAt.size, 0);
});

test("a refetch replaces the waiting set with the agent's pending requests", () => {
  const tracker = new PermissionTracker();
  tracker.onEvent(requested("r1", "t1"), 1000);
  tracker.readAgent({ status: "idle", pendingPermissions: [{ id: "r2", metadata: { toolUseId: "t2" } }] });
  assert.deepEqual([...tracker.waiting], ["t2"]);
  tracker.onEvent(resolved("r2", "allow"), 3000);
  assert.equal(tracker.approvedAt.get("t2"), 3000);
});

test("a refetch without a pending list keeps the waiting set, and a closed agent is flagged", () => {
  const tracker = new PermissionTracker();
  tracker.onEvent(requested("r1", "t1"), 1000);
  tracker.readAgent({ status: "closed" });
  assert.equal(tracker.agentClosed, true);
  assert.deepEqual([...tracker.waiting], ["t1"]);
  tracker.readAgent({ status: "idle" });
  assert.equal(tracker.agentClosed, false);
  tracker.readAgent(undefined);
  assert.equal(tracker.agentClosed, false);
});

test("pruning drops the approval times of finished steps only", () => {
  const tracker = new PermissionTracker();
  tracker.onEvent(requested("r1", "t1"), 0);
  tracker.onEvent(requested("r2", "t2"), 0);
  tracker.onEvent(resolved("r1", "allow"), 1000);
  tracker.onEvent(resolved("r2", "allow"), 2000);
  tracker.prune(new Set(["t1"]));
  assert.deepEqual([...tracker.approvedAt.keys()], ["t2"]);
});
