import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import type { Activity, ActivityStep, StepBody, StepStatus } from "../shared/activity.ts";

type ToolCallItem = Extract<AgentTimelineItem, { type: "tool_call" }>;
type ReasoningItem = Extract<AgentTimelineItem, { type: "reasoning" }>;
type Phase = "streaming" | "complete";

/** `null` hides the item, `undefined` keeps Paseo's default rendering. */
export type ClassifyResult = ActivityStep | null | undefined;

const TARGET_MAX = 120;
const COMMAND_MAX = 80;
const FIELD_MAX = 8 * 1024;
const ERROR_MAX = 2000;
const RUNNING_TAIL_LINES = 12;
const DONE_HEAD_LINES = 40;
const DIFF_MAX_LINES = 60;
const PREVIEW_LINES = 20;

const NAME_ACTIVITY: Record<string, Activity> = {
  bash: "run",
  read: "read",
  edit: "edit",
  multiedit: "edit",
  write: "write",
  agent: "delegate",
  task: "delegate",
  websearch: "web",
  webfetch: "web",
  grep: "search",
  glob: "search",
};

export function classifyToolCall(item: ToolCallItem, phase: Phase): ClassifyResult {
  try {
    return buildToolStep(item, phase);
  } catch {
    return undefined;
  }
}

export function classifyReasoning(item: ReasoningItem, phase: Phase): ClassifyResult {
  try {
    if (typeof item.text !== "string" || item.text.trim() === "") return null;
    const text = clip(item.text.trim(), FIELD_MAX);
    return {
      activity: "think",
      status: phase === "streaming" ? "running" : "done",
      target: clip(firstLine(text), TARGET_MAX),
      body: { kind: "stream", text },
    };
  } catch {
    return undefined;
  }
}

function buildToolStep(item: ToolCallItem, _phase: Phase): ClassifyResult {
  const detail = item.detail;
  if (detail.type === "plain_text") {
    if (item.name === "agent_message") return undefined;
    if (item.name === "task_notification") return null;
  }

  const activity = activityOf(item);
  const status = statusOf(item);
  const step: ActivityStep = { callId: item.callId, activity, status, target: "" };
  const details: Array<{ label: string; value: string }> = [];
  const addDetail = (label: string, value: string | undefined) => {
    if (value) details.push({ label, value: clip(value, TARGET_MAX * 4) });
  };
  let meta: string | undefined;
  let body: StepBody | undefined;
  let target = "";

  switch (detail.type) {
    case "shell":
      target = commandTarget(detail.command);
      body = outputBody(detail.output, status);
      break;
    case "worktree_setup":
      target = detail.branchName ? `worktree ${detail.branchName}` : "worktree";
      body = outputBody(detail.log, status);
      break;
    case "read":
      target = shortPath(detail.filePath);
      addDetail("Path", detail.filePath);
      if (status === "done" && typeof detail.content === "string") {
        meta = plural(countLines(detail.content), "line");
      }
      body = headBody(detail.content, PREVIEW_LINES);
      break;
    case "write":
      target = shortPath(detail.filePath);
      addDetail("Path", detail.filePath);
      if (typeof detail.content === "string") meta = plural(countLines(detail.content), "line");
      body = headBody(detail.content, PREVIEW_LINES);
      break;
    case "edit": {
      target = shortPath(detail.filePath);
      addDetail("Path", detail.filePath);
      const { oldString, newString } = detail;
      if (typeof oldString === "string" && typeof newString === "string") {
        meta = `+${countLines(newString)} −${countLines(oldString)}`;
        body = diffBody(oldString, newString);
      }
      break;
    }
    case "search": {
      const web = detail.toolName === "web_search";
      target = clip(detail.query, TARGET_MAX);
      if (!web) {
        const parts: string[] = [];
        if (typeof detail.numFiles === "number") parts.push(plural(detail.numFiles, "file"));
        if (typeof detail.numMatches === "number") parts.push(plural(detail.numMatches, "match"));
        if (parts.length > 0) meta = parts.join(" · ");
        if (detail.toolName === "grep" || detail.toolName === "glob") {
          addDetail("Tool", detail.toolName);
        }
        body = headBody(detail.filePaths?.join("\n") ?? detail.content, PREVIEW_LINES);
      }
      break;
    }
    case "fetch":
      target = urlTarget(detail.url);
      addDetail("URL", detail.url);
      if (typeof detail.code === "number") meta = `HTTP ${detail.code}`;
      body = headBody(detail.result, PREVIEW_LINES);
      break;
    case "sub_agent":
      target = clip(detail.description ?? detail.subAgentType ?? item.name, TARGET_MAX);
      break;
    case "plan":
      target = clip(firstLine(detail.text), TARGET_MAX);
      body = headBody(detail.text, PREVIEW_LINES);
      break;
    case "plain_text":
      target = clip(detail.label ?? item.name, TARGET_MAX);
      body = headBody(detail.text, PREVIEW_LINES);
      break;
    case "unknown": {
      const named = NAME_ACTIVITY[item.name.toLowerCase()];
      target = unknownTarget(item.name, named, detail.input);
      body = jsonBody(detail.output ?? detail.input);
      break;
    }
  }

  if (status === "failed") {
    const errorText = errorTextOf(item.error);
    if (errorText) step.errorText = errorText;
    meta = exitMeta(errorText) ?? "failed";
  }

  step.target = target === "" ? item.name : target;
  if (meta) step.meta = meta;
  addDetail("Tool", item.name);
  if (details.length > 0) step.details = details;
  if (body) step.body = body;
  return step;
}

function activityOf(item: ToolCallItem): Activity {
  switch (item.detail.type) {
    case "shell":
    case "worktree_setup":
      return "run";
    case "read":
      return "read";
    case "edit":
      return "edit";
    case "write":
      return "write";
    case "search":
      return item.detail.toolName === "web_search" ? "web" : "search";
    case "fetch":
      return "web";
    case "sub_agent":
      return "delegate";
    case "plan":
      return "plan";
    case "plain_text":
      return "tool";
    case "unknown":
      return NAME_ACTIVITY[item.name.toLowerCase()] ?? "tool";
  }
}

function statusOf(item: ToolCallItem): StepStatus {
  switch (item.status) {
    case "running":
      return "running";
    case "completed":
      return "done";
    case "failed":
      return "failed";
    case "canceled":
      return "canceled";
  }
}

function unknownTarget(name: string, named: Activity | undefined, input: unknown): string {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  if (mcp) return `${mcp[1]} · ${mcp[2]}`;
  if (named && input && typeof input === "object") {
    const record = input as Record<string, unknown>;
    for (const key of ["command", "file_path", "path", "pattern", "query", "url", "description"]) {
      const value = record[key];
      if (typeof value === "string" && value !== "") {
        return named === "run" ? commandTarget(value) : clip(value, TARGET_MAX);
      }
    }
  }
  return name;
}

function commandTarget(command: string): string {
  const lines = command.split("\n").map((line) => line.trim());
  const first = lines.find((line) => line !== "") ?? "";
  const multiline = lines.filter((line) => line !== "").length > 1;
  if (first.length > COMMAND_MAX) return `${first.slice(0, COMMAND_MAX)}…`;
  return multiline ? `${first}…` : first;
}

function shortPath(path: string): string {
  const segments = path.split("/").filter((segment) => segment !== "");
  return segments.slice(-2).join("/") || path;
}

function urlTarget(url: string): string {
  try {
    const parsed = new URL(url);
    return clip(`${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`, TARGET_MAX);
  } catch {
    return clip(url, TARGET_MAX);
  }
}

function errorTextOf(error: unknown): string | undefined {
  if (typeof error === "string") return error === "" ? undefined : clip(error, ERROR_MAX);
  if (error && typeof error === "object") {
    const content = (error as { content?: unknown }).content;
    if (typeof content === "string" && content !== "") return clip(content, ERROR_MAX);
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message !== "") return clip(message, ERROR_MAX);
  }
  return undefined;
}

function exitMeta(errorText: string | undefined): string | undefined {
  const match = errorText ? /^Exit code (\d+)/.exec(errorText) : null;
  return match ? `exit ${match[1]}` : undefined;
}

function outputBody(output: string | undefined, status: StepStatus): StepBody | undefined {
  if (typeof output !== "string" || output.trim() === "") return undefined;
  const lines = output.replace(/\n+$/, "").split("\n");
  if (status === "running") {
    const hidden = Math.max(0, lines.length - RUNNING_TAIL_LINES);
    return mono(lines.slice(hidden), hidden);
  }
  return mono(lines.slice(0, DONE_HEAD_LINES), Math.max(0, lines.length - DONE_HEAD_LINES));
}

function headBody(text: string | undefined, max: number): StepBody | undefined {
  if (typeof text !== "string" || text.trim() === "") return undefined;
  const lines = text.replace(/\n+$/, "").split("\n");
  return mono(lines.slice(0, max), Math.max(0, lines.length - max));
}

function diffBody(oldString: string, newString: string): StepBody {
  const lines = [
    ...splitLines(oldString).map((line) => `-${line}`),
    ...splitLines(newString).map((line) => `+${line}`),
  ];
  const kept = lines.slice(0, DIFF_MAX_LINES);
  const hiddenLines = lines.length - kept.length;
  return {
    kind: "diff",
    text: clip(kept.join("\n"), FIELD_MAX),
    ...(hiddenLines > 0 ? { hiddenLines } : {}),
  };
}

function jsonBody(value: unknown): StepBody | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const text = typeof value === "string" ? value : safeStringify(value);
  return headBody(text, PREVIEW_LINES);
}

function mono(lines: string[], hiddenLines: number): StepBody {
  return {
    kind: "mono",
    text: clip(lines.join("\n"), FIELD_MAX),
    ...(hiddenLines > 0 ? { hiddenLines } : {}),
  };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return "";
  }
}

function splitLines(text: string): string[] {
  return text === "" ? [] : text.replace(/\n$/, "").split("\n");
}

function countLines(text: string): number {
  return splitLines(text).length;
}

function plural(count: number, noun: string): string {
  const suffix = noun.endsWith("ch") ? "es" : "s";
  return `${count} ${noun}${count === 1 ? "" : suffix}`;
}

function firstLine(text: string): string {
  return text.split("\n").find((line) => line.trim() !== "")?.trim() ?? "";
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
