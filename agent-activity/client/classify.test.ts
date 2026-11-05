import assert from "node:assert/strict";
import { test } from "node:test";
import { activityStepSchema } from "../shared/activity.ts";
import { classifyReasoning, classifyToolCall } from "./classify.ts";

// Fixtures follow the shapes observed on Claude Code in docs/observed/agent-activity.md.
function tool(partial: Record<string, unknown>): any {
  return { type: "tool_call", callId: "c1", name: "Bash", status: "completed", error: null, ...partial };
}

function step(item: any, phase: "streaming" | "complete" = "complete") {
  const result = classifyToolCall(item, phase);
  assert.ok(result, "expected a step");
  activityStepSchema.parse(result);
  return result;
}

test("shell becomes run with the first command line", () => {
  const result = step(tool({ detail: { type: "shell", command: "npm test", output: "ok\n" } }));
  assert.equal(result.activity, "run");
  assert.equal(result.status, "done");
  assert.equal(result.target, "npm test");
  assert.equal(result.body?.text, "ok");
});

test("multi-line and long commands are cut", () => {
  const multi = step(tool({ detail: { type: "shell", command: "\n cd x &&\n make\n" } }));
  assert.equal(multi.target, "cd x &&…");
  const long = step(tool({ detail: { type: "shell", command: "a".repeat(200) } }));
  assert.equal(long.target, `${"a".repeat(80)}…`);
});

test("a running Bash call still unknown is already a run step", () => {
  const result = step(
    tool({ status: "running", name: "Bash", detail: { type: "unknown", input: { command: "sleep 8" }, output: null } }),
    "streaming",
  );
  assert.equal(result.activity, "run");
  assert.equal(result.status, "running");
  assert.equal(result.target, "sleep 8");
});

test("unknown with empty input falls back to the tool name", () => {
  const result = step(tool({ status: "running", name: "Read", detail: { type: "unknown", input: {}, output: null } }));
  assert.equal(result.activity, "read");
  assert.equal(result.target, "Read");
});

test("failed shell parses the exit code from the error content", () => {
  const result = step(
    tool({
      status: "failed",
      detail: { type: "shell", command: "npm test", output: "boom" },
      error: { type: "tool_result", content: "Exit code 2\nstderr line", is_error: true },
    }),
  );
  assert.equal(result.status, "failed");
  assert.equal(result.meta, "exit 2");
  assert.match(result.errorText ?? "", /^Exit code 2/);
});

test("failed tool without an exit code shows failed", () => {
  const result = step(
    tool({
      status: "failed",
      name: "Read",
      detail: { type: "read", filePath: "/a/b/missing.ts" },
      error: { type: "tool_result", content: "File does not exist", is_error: true },
    }),
  );
  assert.equal(result.meta, "failed");
  assert.equal(result.target, "b/missing.ts");
});

test("canceled keeps its activity", () => {
  const result = step(tool({ status: "canceled", detail: { type: "shell", command: "sleep 99" } }));
  assert.equal(result.status, "canceled");
  assert.equal(result.activity, "run");
});

test("read shows line count only when complete", () => {
  const running = step(tool({ status: "running", name: "Read", detail: { type: "read", filePath: "/x/y/z.ts" } }));
  assert.equal(running.meta, undefined);
  const done = step(tool({ name: "Read", detail: { type: "read", filePath: "/x/y/z.ts", content: "a\nb\nc\n" } }));
  assert.equal(done.meta, "3 lines");
  assert.equal(done.target, "y/z.ts");
  assert.deepEqual(done.details?.[0], { label: "Path", value: "/x/y/z.ts" });
});

test("edit counts lines from oldString and newString", () => {
  const result = step(
    tool({ name: "Edit", detail: { type: "edit", filePath: "/a/b.ts", oldString: "x", newString: "y\nz" } }),
  );
  assert.equal(result.activity, "edit");
  assert.equal(result.meta, "+2 −1");
  assert.equal(result.body?.kind, "diff");
  assert.equal(result.body?.text, "-x\n+y\n+z");
});

test("edit without both strings has no meta yet", () => {
  const result = step(tool({ status: "running", name: "Edit", detail: { type: "edit", filePath: "/a/b.ts", oldString: "x" } }));
  assert.equal(result.meta, undefined);
  assert.equal(result.body, undefined);
});

test("write counts lines", () => {
  const result = step(tool({ name: "Write", detail: { type: "write", filePath: "/a/b.ts", content: "1\n2\n" } }));
  assert.equal(result.activity, "write");
  assert.equal(result.meta, "2 lines");
});

test("web_search is web without meta, grep is search", () => {
  const web = step(tool({ name: "WebSearch", detail: { type: "search", toolName: "web_search", query: "paseo" } }));
  assert.equal(web.activity, "web");
  assert.equal(web.meta, undefined);
  const grep = step(
    tool({ name: "Grep", detail: { type: "search", toolName: "grep", query: "foo", numFiles: 1, numMatches: 4 } }),
  );
  assert.equal(grep.activity, "search");
  assert.equal(grep.meta, "1 file · 4 matches");
});

test("fetch shows host, path and HTTP code", () => {
  const result = step(tool({ name: "WebFetch", detail: { type: "fetch", url: "https://paseo.sh/docs/x", code: 200 } }));
  assert.equal(result.activity, "web");
  assert.equal(result.target, "paseo.sh/docs/x");
  assert.equal(result.meta, "HTTP 200");
});

test("sub_agent becomes delegate using the description", () => {
  const result = step(
    tool({ name: "Task", detail: { type: "sub_agent", subAgentType: "Explore", description: "Find usages", actions: [] } }),
  );
  assert.equal(result.activity, "delegate");
  assert.equal(result.target, "Find usages");
  assert.equal(result.meta, undefined);
});

test("plan uses the first line", () => {
  const result = step(tool({ name: "ExitPlanMode", detail: { type: "plan", text: "\nStep one\nStep two" } }));
  assert.equal(result.activity, "plan");
  assert.equal(result.target, "Step one");
});

test("MCP tools show server and function", () => {
  const result = step(
    tool({ name: "mcp__chrome-devtools__list_pages", detail: { type: "unknown", input: {}, output: { pages: [] } } }),
  );
  assert.equal(result.activity, "tool");
  assert.equal(result.target, "chrome-devtools · list_pages");
});

test("plain_text tools: agent_message keeps default, task_notification is hidden", () => {
  const message = tool({ name: "agent_message", detail: { type: "plain_text", label: "Agent", text: "hi" } });
  assert.equal(classifyToolCall(message, "complete"), undefined);
  const notification = tool({ name: "task_notification", detail: { type: "plain_text", text: "done" } });
  assert.equal(classifyToolCall(notification, "complete"), null);
  const other = step(tool({ name: "custom", detail: { type: "plain_text", label: "Label", text: "t" } }));
  assert.equal(other.activity, "tool");
  assert.equal(other.target, "Label");
});

test("shell output is the last 12 lines while running and the first 40 when done", () => {
  const output = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n");
  const running = step(tool({ status: "running", detail: { type: "shell", command: "x", output } }), "streaming");
  assert.equal(running.body?.text.split("\n")[0], "line 89");
  assert.equal(running.body?.hiddenLines, 88);
  const done = step(tool({ detail: { type: "shell", command: "x", output } }));
  assert.equal(done.body?.text.split("\n").length, 40);
  assert.equal(done.body?.hiddenLines, 60);
});

test("huge fields are clipped to about 8 KB", () => {
  const result = step(tool({ detail: { type: "shell", command: "x", output: "y".repeat(50_000) } }));
  assert.ok((result.body?.text.length ?? 0) <= 8 * 1024);
});

test("strange data returns undefined instead of throwing", () => {
  assert.equal(classifyToolCall(tool({ detail: null }), "complete"), undefined);
  assert.equal(classifyToolCall({} as any, "complete"), undefined);
});

test("reasoning: running while streaming, done when complete", () => {
  const streaming = classifyReasoning({ type: "reasoning", text: "Let me check\nmore" }, "streaming");
  assert.equal(streaming?.status, "running");
  assert.equal(streaming?.target, "Let me check");
  const complete = classifyReasoning({ type: "reasoning", text: "Let me check" }, "complete");
  assert.equal(complete?.status, "done");
  assert.equal(complete?.activity, "think");
});

test("empty or whitespace reasoning is removed", () => {
  assert.equal(classifyReasoning({ type: "reasoning", text: "  \n " }, "complete"), null);
  assert.equal(classifyReasoning({ type: "reasoning", text: "" }, "streaming"), null);
});

test("tool steps carry the call id and reasoning does not", () => {
  assert.equal(step(tool({ callId: "toolu_1", detail: { type: "shell", command: "x" } })).callId, "toolu_1");
  assert.equal(classifyReasoning({ type: "reasoning", text: "hm" }, "complete")?.callId, undefined);
});
