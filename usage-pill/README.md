# usage-pill

Composer pills showing the agent provider's plan usage (session/weekly %) and the agent's context-window use.
For OMP agents, the usage pill reads quota from the `omp usage --json` CLI on the daemon machine.

## Prerequisites

- The Paseo daemon runs on this machine and the `paseo` CLI is on `PATH`.
- Node.js and npm are installed.
- The daemon version satisfies `requirements.paseo` in `paseo-plugin.json` (`>=0.10.2`); check it with `paseo daemon status --json`.
- Plugins are enabled on the daemon: the root `"pluginsEnabled": true` field in `<daemon home>/config.json`.
  If it is false or missing, ask the human before enabling it, because plugins are trusted, unsandboxed code.
  After enabling, run `paseo reload --json` and require `pluginsEnabled` in `appliedPaths`.
- Optional: the `omp` CLI on the daemon's `PATH` for OMP quota.

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
If `usage-pill` is already installed from another directory, run `paseo plugin remove usage-pill` first.

## Update

After editing the source:

```bash
npm install
npm run typecheck
paseo plugin reload usage-pill
```

Do not restart the daemon to load source changes; a restart kills running agents.

## Verify

Open an agent in the Paseo app and confirm the composer track bar shows the usage pill (for example `Claude 12%/40%`) and the `Ctx N%` pill after the agent's first turn.
Hover a pill to see the per-window details and reset times.

Automated runtime E2E lives in `e2e/` and runs against an isolated E2E daemon, never your own; follow `.claude/skills/runtime-e2e-test/references/project-runtime.md` at the repository root.

## Troubleshoot

- `paseo plugin ls` shows the status and load error.
- `paseo plugin logs usage-pill` shows recent plugin output, including `[usage-pill]` errors.
- A `requires Paseo >=x.y.z` install error means the daemon is older than `requirements.paseo`; update Paseo first.

## Remove

```bash
paseo plugin remove usage-pill
```

Removing a local plugin keeps its source directory.
