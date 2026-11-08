import assert from "node:assert/strict";
import { test } from "node:test";
import { isLight } from "./palette.ts";

test("isLight reads hex and rgb colors and treats unknown input as dark", () => {
  assert.equal(isLight("#ffffff"), true);
  assert.equal(isLight("#fff"), true);
  assert.equal(isLight("#181b1a"), false);
  assert.equal(isLight("rgb(250, 250, 250)"), true);
  assert.equal(isLight("rgba(10,10,10,0.9)"), false);
  assert.equal(isLight("hsl(0 0% 100%)"), false);
});
