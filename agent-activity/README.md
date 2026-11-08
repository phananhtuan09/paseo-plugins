# agent-activity

"Flow": replaces the tool-call and reasoning rows of an agent timeline with activity steps (Read, Edited, Ran, Searched, Thought) at three detail levels.
It adds two composer pills: a follow pill showing what the agent is doing now, and a Detail pill that switches the level.

- Brief: one chip per step, with the file or command and a short result such as `+1 −1` or `exit 1`.
- Steps: rows grouped into runs and phases (Explore, Change, Verify), with a run header such as `3 steps · 10s · 1 failed`. Tap a row to open that step only.
- Full: every step is open, with file content, diffs, output and the full shell command.
  Shell commands, and the content of `ts`, `tsx`, `js`, `json`, `py`, `sh`, `yaml` and `toml` files, are syntax highlighted.

At Brief and Steps a running step also shows what the user needs to decide whether to wait (policy: `RUNNING-STEP-POLICY.md`):

- A running command shows a clock that counts up from its start, one per step.
- `Waiting for approval` (amber, with no clock) while a permission request is unanswered; after approval the clock starts again.
- `In background · 3m 20s` (dashed border) for a Claude Code command moved to the background by its timeout or `run_in_background`.
  It ends as `Ran` with its total time, or `exit N · 3m 22s` in red, when Claude Code's completion notification arrives (`killed` in red if the command was stopped, for example by a daemon restart).
  `status unknown` appears if the agent closed before that notification.
- A denied permission request shows `denied` in red.
- Times from one hour show as `1h 15m`.

The chosen level is kept in the browser (`localStorage`) and applies to every agent.
Answers and user messages keep Paseo's default rendering.

## Prerequisites

- The Paseo daemon runs on this machine and the `paseo` CLI is on `PATH`.
- Node.js and npm are installed.
- The daemon version satisfies `requirements.paseo` in `paseo-plugin.json` (`>=0.13.0`); check it with `paseo daemon status --json`.
- Plugins are enabled on the daemon: the root `"pluginsEnabled": true` field in `<daemon home>/config.json`.
  If it is false or missing, ask the human before enabling it, because plugins are trusted, unsandboxed code.
  After enabling, run `paseo reload --json` and require `pluginsEnabled` in `appliedPaths`.

## Install

Run from this directory:

```bash
npm install
npm run typecheck
paseo plugin install "$PWD"
paseo plugin ls
```

The plugin must show `running` with no error.
Paseo loads the plugin from this directory, so keep the source in place after installing.
If `agent-activity` is already installed from another directory, run `paseo plugin remove agent-activity` first.

## Update

After editing the source:

```bash
npm install
npm run typecheck
npm test
paseo plugin reload agent-activity
```

Do not restart the daemon to load source changes; a restart kills running agents.

## Verify

Open an agent in the Paseo app and send a prompt that reads a file, edits it and runs a failing command, for example `ls /nonexistent`.
Confirm the following:

- The timeline shows `Read`, `Edited` with `+X −Y`, and a failed `Ran` with its exit code, in the Brief chips.
- The composer shows a short follow pill (the phase, then `Done`; hover for the full step and step count) and a pill with only the Detail level (`Brief`, `Steps` or `Full`).
- Tapping the Detail pill cycles Brief, Steps and Full, and every step changes with it.
- At Steps, each run has a header with its step count and duration, and a phase label sits above each phase.
- A command that runs for a few seconds shows a clock at Brief and Steps.
  In an agent in `default` mode, a command that needs approval shows `Waiting for approval` until you allow or deny it.
  A command that runs past Claude Code's 120 s timeout shows `In background` and ends with its total time.
- At Full, a shell step shows its full command highlighted, and a read of a `.ts` file shows highlighted code.

Unit tests (`npm test`) cover the step classifier, run and phase grouping, the highlighter and the palette.
Automated runtime E2E lives in `e2e/` and runs against an isolated E2E daemon, never your own; follow `.claude/skills/runtime-e2e-test/references/project-runtime.md` at the repository root.
Its fixture needs one agent whose turns are, in order: reply `OK`, read and edit `notes.txt` and run a failing `ls /nonexistent-e2e-path`, then run `sleep 8 && echo done` twice, in a directory that is not a git repository.
Pass the agent id as `E2E_AGENT_ID` and the directory name as `E2E_WORKSPACE_NAME`.

## Known limits

- Reasoning steps appear only for models that emit reasoning; they were not seen in Claude Haiku 5.5 runs.
- The run duration is approximate: the timeline has no start time for a finished tool call, so a run starts at the entry before it.
- Claude Code and Codex agents were checked at runtime; OMP was not.
- Codex edits use `unifiedDiff`; the plugin shows that diff and counts its added and removed lines.
  Failed shell calls use the structured exit code when available.
- After a turn stops, unresolved tool rows display a stopped state and elapsed timers freeze.
  Duplicate records for one call are shown once, using the terminal result when available.
  This changes activity display only: Paseo/Codex may let the shell process finish after Stop, and a late result then replaces the stopped row.
- Brief, Steps and Full share the latest 200 timeline entries for status reconciliation and headers.
- The phase and code colors are fixed blue, amber and violet with a dark and a light variant, chosen from the theme's brightness; they do not follow custom theme accents.

- Whether a command is still printing output is not shown: Claude Code gives a Bash command's output only when it finishes.
- `In background` depends on Claude Code's wording in the command output (`moved to the background`, `Command running in background`); if it changes, the step shows `Ran` as before.
- After reloading the page while a command waits for approval, the clock after approval counts from the request, because the approval time is not recorded.
- Commands inside a sub-agent are not in the timeline, and `canceled` does not say whether the process is still running.

## Troubleshoot

- `paseo plugin ls` shows the status and load error.
- `paseo plugin logs agent-activity` shows recent plugin output.
- If rows look unchanged, reload the page once after installing or reloading the plugin.
- A browser console warning `[Plugins] Timeline transformer failed` means a tool call had a shape the classifier did not expect; the row then falls back to Paseo's default.
- A `requires Paseo >=x.y.z` install error means the daemon is older than `requirements.paseo`; update Paseo first.

## Remove

```bash
paseo plugin remove agent-activity
```

Removing a local plugin keeps its source directory.
Disabling it with `paseo plugin disable agent-activity` restores Paseo's default timeline and removes both pills without a reload.
