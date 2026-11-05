# agent-activity

Scope: Paseo 0.15.0 timeline transformer, renderer, composer pill and storage behavior, and the Claude Code timeline item shapes, that the planned `agent-activity` plugin depends on

## Facts

### Method

- Spike runs on 2026-11-05 on an isolated E2E daemon (home `/tmp/paseo-e2e-home`, port 6801, Paseo 0.15.0) with throwaway plugins in `/tmp/aa-spike/plugin`, which is not kept in the repository. Evidence: `docs/plans/active/agent-activity.md`
- Run 1 used a plugin that replaced `tool_call` and `reasoning` items and rendered diagnostics. Run 2 used an observe-only plugin that logged every transformer input and every live `timeline.subscribe` event to the browser console. Evidence: console logs `[obs:transform]` and `[obs:live]` in those runs
- Three Claude Code agent turns were observed in run 2 (Haiku 5.5 twice, Sonnet 5.5 with thinking `high` once), all in `bypassPermissions` mode, plus two Haiku turns in run 1. Evidence: spike runs

### Rendering and host behavior

- Each plugin timeline item is wrapped by Paseo in a `data-plugin-row` element whose inner wrapper has `marginBottom: 16px`. A renderer that returns `null` still occupies 16 px. Three consecutive empty items measured as three stacked 16 px rows. A content row measured content height + 16 px. Evidence: DOM measurement in run 1
- The renderer props include `theme`, `agentId`, `item` and `timestamp`, and `npm run typecheck` accepts `theme.colors` use in a renderer. Evidence: `PluginTimelineItemProps` in `@getpaseo/plugin` 0.15.0 and run 1 typecheck
- A transformer id containing `_` is rejected with `Invalid timeline transformer id`, and the whole plugin client entry then fails to evaluate. Evidence: console warning `[Plugins] Failed to evaluate ... Invalid timeline transformer id: obs-user_message`
- Transformers run only for timelines that are rendered. An agent that was not open produced live events but no transformer calls. Evidence: run 2 logs for agent `6780ae26`
- With the plugin disabled (`paseo plugin disable`), the open page reverted to Paseo's default rendering without a reload. The default groups tools into one summary line per turn, for example `Ran 1 command and read 1 file`. With the plugin enabled that grouping was absent. Evidence: DOM text before and after disable in run 1
- The SDK types expose no API to scroll the timeline to an item. `PluginTab.setState` persists state only for workspace and agent panels, and `defineSettings` persists host-scoped settings through the daemon. Evidence: `@getpaseo/plugin` 0.15.0 `dist/client/contracts.d.ts`, `dist/settings.d.ts`
- `localStorage` is available in the web client and a write followed by a read succeeded. Native storage was not tested. Evidence: run 1 diagnostic text `localStorage ok`
- A web tab keeps the previous daemon's `serverId` after the E2E home is recreated, and its agent panel then spins forever. A fresh browser context loads normally. Evidence: run 2, `srv_FEs_C6nqtCkr` versus `srv_1L2Krla3smLp`

### Timeline subscription

- `usePaseo().agents.ref(id).timeline.refetch({ direction: "tail", limit: 200 })` works from inside a renderer and returns a payload with keys `agentId, agent, direction, epoch, window, hasOlder, hasNewer, entries`. Evidence: run 1 log `[spike] refetch keys`, `refetch=4` and `refetch=8`
- `timeline.subscribe(handler)` delivers live events during a running turn: `turn_started`, `thread_started`, `timeline` (one per item update), `turn_completed` (with `usage`). Each event carries `seq`, `epoch` and `turnId`. Evidence: run 1 console `[spike] timeline event turn_started`, run 2 `[obs:live]`
- `client.paseo.agents.list({ subscribe: {} })` delivers a snapshot and then `agent_update` upserts, so a subscription started in the client entry also covers agents created later. Evidence: run 2, agent `6780ae26` created after plugin load and observed from `turn_started`

### Transformer calls

- One tool call produces several transformer calls: each state change calls the transformer again with `phase: "streaming"` while `status` is `running`, then once with `phase: "complete"`. Loading history calls the transformer once per item with `phase: "complete"`. Evidence: run 2 `[obs:transform]` for callId `toolu_01JFQb2U...`
- A tool call's `detail` evolves while running. It first arrives as `detail.type: "unknown"` with empty `input` and the tool `name` already set (`Bash`, `Read`, `Edit`, `Agent`, `WebSearch`), then becomes a typed detail with partial fields, then completes with output. For `Edit` the typed detail gained `filePath`, then `oldString`, then `newString`, one live event each. Evidence: run 2 live events for `Bash` `toolu_01Xf3amH...` and `Edit` `toolu_01Ps3W7b...`
- An `Agent` tool call changes `name` to `Task` and `detail.type` to `sub_agent` after about 0.5 s, and its live completed event shows `unknown` again while the transformer sees `sub_agent`. Evidence: run 2 events `msgid=71..82`
- A finished `tool_call` entry is stamped when it ended, not when it started: a `sleep 8` call had timestamp 14:57:30.3 and the answer after it 14:57:31.1, while the entry before it (a hidden `agent_message`) was 14:57:21.3. A running call is stamped when it started, and the entry has no start or duration field. Evidence: WebSocket timeline payload in the E2E re-run 2026-11-05
- Assistant message text streams as accumulated text with `phase: "streaming"` (the transformer sees the full text so far) and a final `phase: "complete"` call. The live event carries only the new chunk. Reasoning items also stream in chunks and have only a `text` field and no `status`. Evidence: run 2 `msgid=83..108` and `msgid=112..133`
- Haiku 5.5 at thinking `Medium` emitted no `reasoning` item in four turns. Sonnet 5.5 at thinking `high` emitted reasoning. Evidence: run 1 and run 2 logs

### Claude Code item shapes

- `Bash` maps to `detail.type: "shell"` with `command` and, once finished, `output`. `cwd` and `exitCode` were absent in every observed shell call. Evidence: run 2 `[obs:transform]` `msgid=8`, `40`
- A failed `Bash` has `status: "failed"` and `error: { type: "tool_result", content, is_error: true }`, where `content` starts with `Exit code 2\n` followed by stderr. Evidence: run 2 `msgid=61`
- The exit code in a failed `Bash` result is the real exit code of the command, so `ls` on a missing path gave `Exit code 1` on macOS (BSD `ls`) and `Exit code 2` in the earlier run. Tests must not hard-code one value. Evidence: E2E re-run 2026-11-05, chip text `exit 1`
- `Read` maps to `detail.type: "read"` with `filePath`, and on completion `content` and `offset: 1`. `limit` was absent. A `Read` of a missing file has `status: "failed"`, no `content`, and `error.content` `File does not exist...`. Evidence: run 2 `msgid=3`, `12`
- `Edit` maps to `detail.type: "edit"` with `filePath`, `oldString` and `newString`. `unifiedDiff` was absent. Evidence: run 2 `msgid=4` and live events for `Edit`
- `Write` maps to `detail.type: "write"` with `filePath` and `content`. Evidence: run 2 `msgid=5`
- `WebSearch` maps to `detail.type: "search"` with `toolName: "web_search"` and `query`. No `webResults`, `numFiles` or `numMatches` were present when completed. Evidence: run 2 `msgid=54`, `70`
- A `Task` sub-agent maps to `detail.type: "sub_agent"` with `subAgentType`, `description`, `log: ""` and `actions: []`, and `actions` stayed empty on completion. Evidence: run 2 `msgid=80`, `82`
- An MCP tool call (`mcp__chrome-devtools__list_pages`) and `ToolSearch` map to `detail.type: "unknown"` with `input` and `output`. A failed MCP call has `error.content` text only. Evidence: run 2 `msgid=58`, `67`, `36`
- A failed `Grep` (tool unavailable) maps to `detail.type: "search"` with `toolName: "grep"`, `query` and `status: "failed"`. Evidence: run 2 `msgid=6`
- Paseo emits synthetic `tool_call` items with `detail.type: "plain_text"`. `name: "agent_message"` (callId prefix `paseo-agent-message:`, `icon: "bot"`) carries the text of a message sent by another agent or by `paseo send`. `name: "task_notification"` (`metadata.synthetic: true`, `source: "claude_task_notification"`, `toolUseId` pointing at the original call) appeared for each `Bash` call that ran `sleep 3`, and duplicates a `Bash` item with the same label as its text. Evidence: run 2 `msgid=16`, `38`, `44`
- Two `Bash` calls issued in one message ran in parallel as separate callIds, both `running` at once, and completed independently. Evidence: run 2 `msgid=20..44`
- `user_message` and `assistant_message` items reach the transformer with `text` and `messageId`. Evidence: run 2 `msgid=2`, `7`

### Not observable in this environment

- `TodoWrite`, `Grep`, `Glob` and `WebFetch` do not exist in the Claude Code session that Paseo 0.15.0 started, for both Haiku 5.5 and Sonnet 5.5. `ToolSearch` returned `No matching deferred tools found`, and the agents substituted `Bash` or a `web-fetch` sub-agent. Evidence: run 2 `msgid=9`, `36`, `68` and the agents' final messages
- No `todo`, `plan`, `compaction`, `error`, `notification`, `fetch` or `worktree_setup` item was observed. Evidence: run 2 logs

### Codex on Paseo 0.15.2

- Codex `apply_patch` returns an edit detail with `filePath` and `unifiedDiff`, without `oldString` and `newString`.
  The classifier now supports this shape.
  Evidence: `agent-activity/client/classify.test.ts`, test `Codex unified diff renders changed lines and counts without file headers`.
- Failed Codex shell calls expose `detail.exitCode`, while `error.message` can be only `Tool call failed`.
  Evidence: `agent-activity/client/classify.test.ts`, test `Codex failed shell uses structured exitCode before generic error text`.
- Stopping a Codex turn can leave a running tool entry in the daemon timeline; the shell can complete later as a second record with the same call ID and no turn ID.
  The plugin reconciles these into one row and freezes unresolved steps when the turn is no longer active.
  It does not terminate provider-owned shell processes.
  Evidence: runtime probes on 2026-11-05, agent `0956eb72-9042-4b0d-b0a1-3cd2cfe419fb`; regression cases in `agent-activity/client/timeline-rows.test.ts`.

## Open questions

- Whether Paseo's default rendering shows or hides `task_notification` items, which decides whether the plugin should hide them.
- Whether `Grep`, `Glob`, `WebFetch` and `TodoWrite` exist in a normal Claude Code session outside Paseo's E2E setup and map to `search`, `fetch` and `todo`.
- Whether OMP tool calls map to the same `detail.type` values as Claude Code.
- Whether `localStorage` exists on native clients.

## References

- `docs/plans/active/agent-activity.md`
