# agent-activity

"Flow": replaces the tool-call and reasoning rows of an agent timeline with activity steps (Read, Edited, Ran, Searched, Thought) at three detail levels.
It adds two composer pills: a follow pill showing what the agent is doing now, and a Detail pill that switches the level.

- Brief: one chip per step, with the file or command and a short result such as `+1 −1` or `exit 1`.
- Steps: rows grouped into runs and phases (Explore, Change, Verify), with a run header such as `3 steps · 10s · 1 failed`. Tap a row to open that step only.
- Full: every step is open, with file content, diffs, output and the full shell command.
  Shell commands, and the content of `ts`, `tsx`, `js`, `json`, `py`, `sh`, `yaml` and `toml` files, are syntax highlighted.

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
- The composer shows a follow pill (`Running …`, then `Done · N steps · …`) and a `Detail · Brief` pill.
- Tapping the Detail pill cycles Brief, Steps and Full, and every step changes with it.
- At Steps, each run has a header with its step count and duration, and a phase label sits above each phase.
- At Full, a shell step shows its full command highlighted, and a read of a `.ts` file shows highlighted code.

Unit tests (`npm test`) cover the step classifier, run and phase grouping, the highlighter and the palette.
Automated runtime E2E lives in `e2e/` and runs against an isolated E2E daemon, never your own; follow `.claude/skills/runtime-e2e-test/references/project-runtime.md` at the repository root.
Its fixture needs one agent whose turns are, in order: reply `OK`, read and edit `notes.txt` and run a failing `ls /nonexistent-e2e-path`, then run `sleep 8 && echo done` twice, in a directory that is not a git repository.
Pass the agent id as `E2E_AGENT_ID` and the directory name as `E2E_WORKSPACE_NAME`.

## Known limits

- Reasoning steps appear only for models that emit reasoning; they were not seen in Claude Haiku 5.5 runs.
- The run duration is approximate: the timeline has no start time for a finished tool call, so a run starts at the entry before it.
- Only Claude Code agents were checked at runtime; Codex and OMP were not.
- The phase and code colors are fixed blue, amber and violet with a dark and a light variant, chosen from the theme's brightness; they do not follow custom theme accents.

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
