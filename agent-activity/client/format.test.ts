import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDuration } from "./format.ts";

test("formats seconds, minutes and hours", () => {
  assert.equal(formatDuration(-5), "0s");
  assert.equal(formatDuration(59_000), "59s");
  assert.equal(formatDuration(60_000), "1m 00s");
  assert.equal(formatDuration(3_599_000), "59m 59s");
  assert.equal(formatDuration(3_600_000), "1h 00m");
  assert.equal(formatDuration(4_503_000), "1h 15m");
});
