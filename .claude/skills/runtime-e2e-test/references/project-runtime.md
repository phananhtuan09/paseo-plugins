# Project Runtime E2E Reference

This file is a project-local operational reference. Complete it after installing the
skill, keep commands and paths current, and never store secret values here.

- Status: READY
- Maintainer: tuanp6905@gmail.com
- Last verified: 2026-11-04
- Applies to: every Paseo plugin directory in this repository (for example `usage-pill/`)

Use `Status: READY` only after the preflight commands and environment assumptions
below have been verified in this project.
Preflight verified on 2026-11-04 (Paseo 0.15.0, Playwright 1.64.1): the E2E daemon started from a normal terminal listened on `127.0.0.1:6801` with `GET /` 200; `usage-pill` installed and showed `running`; a Claude Haiku fixture agent completed one turn; `usage-pill/e2e` passed on the `desktop` and `compact` projects with screenshots and JUnit output; `paseo daemon stop --home /tmp/paseo-e2e-home` stopped it; the default daemon's plugins were unchanged throughout.

## Project shape

This repository is a collection of Paseo plugins, one directory per plugin (see `AGENTS.md` and
`docs/patterns/plugin-directory-layout.md`).
A plugin has no app of its own: its client code runs inside the Paseo app and its server code runs
as a daemon subprocess.
Runtime E2E therefore drives the **Paseo web UI served by an isolated E2E daemon** with the plugin
installed, never the human's own daemon.

## Runtime topology

| Service | Working directory | Start command | Ready signal | Stop/reset command | Log location |
| --- | --- | --- | --- | --- | --- |
| `paseo-e2e` daemon + bundled web UI | repository root | `paseo daemon start --home /tmp/paseo-e2e-home` (managed background daemon configured by its `config.json`) | `GET http://127.0.0.1:6801/` returns 200 and `paseo daemon status --home /tmp/paseo-e2e-home --json` reports `localDaemon: running` | `paseo daemon stop --home /tmp/paseo-e2e-home`, then `rm -rf /tmp/paseo-e2e-home` | `/tmp/paseo-e2e-home/daemon.log`; plugin output via `paseo plugin logs <id> --home /tmp/paseo-e2e-home` |

Setup before start (once per run):

1. `mkdir -p /tmp/paseo-e2e-home` and write this `/tmp/paseo-e2e-home/config.json`:
   `{"version": 1, "pluginsEnabled": true, "daemon": {"listen": "127.0.0.1:6801", "relay": {"enabled": false}}, "features": {"webUi": {"enabled": true}}}`.
   This enables plugins only on the throwaway E2E daemon, never on `~/.paseo`.
   Do not use foreground `paseo daemon run` with `PASEO_*` overrides from a short-lived shell: on 2026-11-04 it received SIGTERM about 0.7 s after launch from the Paseo `/sh` runner.
2. In the plugin directory: `npm install` and `npm run typecheck`.
3. After the daemon is ready: `paseo plugin install "$PWD" --home /tmp/paseo-e2e-home`, then
   `paseo plugin ls --home /tmp/paseo-e2e-home` must show the plugin `running` with no error.
4. After a source change during a run: `paseo plugin reload <id> --home /tmp/paseo-e2e-home`.

## Environment

- Runtime profile: local isolated E2E daemon, home `/tmp/paseo-e2e-home`, port `6801`.
- Environment file or setup command: `/tmp/paseo-e2e-home/config.json` as written in setup step 1.
- Required variable names: none; pass `--home /tmp/paseo-e2e-home` (or `PASEO_HOME`) on every CLI call.
- Secret acquisition method: none stored. Provider CLIs (Claude Code, Codex, OMP, ...) reuse the human's existing local logins.
- Allowed external dependencies: the provider services used by agents the test starts, and vendor CLIs the plugin calls (for `usage-pill`: the `omp` CLI and provider usage endpoints).
- Prohibited targets: the human's daemon at `127.0.0.1:6767` with home `~/.paseo`, any remote daemon, the relay, and `app.paseo.sh`.
  Never run `paseo` commands without `--home /tmp/paseo-e2e-home` (or `PASEO_HOME`) during E2E, and never restart or stop the default daemon: it runs the agents doing the work.
- Configuration identity to record in plans: `paseo --version`, `daemonVersion` from `paseo daemon status --home /tmp/paseo-e2e-home --json`, plugin `id`, and `requirements.paseo` from its `paseo-plugin.json`.

## Existing E2E entrypoints

- Full-suite command: in `<plugin>/e2e/`, `E2E_WORKSPACE_NAME=<fixture workspace name> npm test` (runs `playwright test` on the `desktop` and `compact` projects).
- Focused-case command/filter: `npx playwright test --grep @<tag> --project desktop` in `<plugin>/e2e/`.
- Browser harness: `usage-pill/e2e/playwright.config.ts`, `@playwright/test` 1.64.1, Chromium headless shell; copy this layout for other plugins.
- Runtime artifacts produced by the harness: `<plugin>/e2e/test-results/` (per-test screenshots, `checkpoint.json` attachments, traces on failure, `junit.xml`).

Existing automated E2E commands may execute cases, but the plan ledger remains the
source for declared paths, observed outcomes, and evidence.

## UI and authentication

- Application URL: `http://127.0.0.1:6801/` (the daemon-served web UI connects back to the same origin, so no "Add Host" step is needed).
- Supported browser/device and viewport: Chromium desktop 1440x900, plus a compact viewport 390x844 because plugins must work in compact layout.
- Authentication setup: none; the E2E daemon has no password and listens on localhost only.
- Roles/accounts available: single local user.
- Navigation: deep links such as `/h/<server>/workspace/<id>` redirect to the home screen on a fresh page load, so open `/` and click the workspace in the sidebar; in compact layout press the `Open menu` button first. The agent screen is ready when the composer placeholder `Message...` is visible.
- Important user entrypoints: workspace list, agent screen with the composer track bar (composer pills), Command Center (Cmd+K), `/` slash commands in the composer, Settings → Plugins (status and logs), Settings → Appearance (theme switch to check text colors).

## API and state observation

- API base URL: `http://127.0.0.1:6801/api`
- Health/readiness endpoint: `GET /` returns 200; `paseo daemon status --home /tmp/paseo-e2e-home --json`.
- Request observation method: Playwright network and WebSocket events in the browser, plus `paseo plugin logs <id> --home /tmp/paseo-e2e-home` for server-side handler output.
- Correlation/trace lookup: timestamps in `/tmp/paseo-e2e-home/daemon.log` and plugin logs.
- Persisted-state observation: `paseo ls --home /tmp/paseo-e2e-home --json`, `paseo inspect <agent> --home /tmp/paseo-e2e-home`, `paseo plugin ls --home /tmp/paseo-e2e-home`, and a page reload. Plugin timeline rows are in memory only and are lost on daemon restart.
- Forbidden shortcuts: editing files under `/tmp/paseo-e2e-home` while the daemon runs (except `config.json` followed by `paseo reload --home /tmp/paseo-e2e-home`), calling plugin RPCs outside the app, and mocking `@getpaseo/plugin` or provider responses.

## Fixtures and cleanup

- Seed/setup command: create the fixture workspace and agent through the CLI against the E2E daemon, for example `paseo run --home /tmp/paseo-e2e-home --cwd /tmp/paseo-e2e-fixtures/$RUNTIME_E2E_RUN_ID --title "e2e-$RUNTIME_E2E_RUN_ID" --provider claude/claude-haiku-5-5 --json "Reply with the single word OK. Do not use tools."`.
  It creates a workspace named after the fixture directory (`$RUNTIME_E2E_RUN_ID`), which is the `E2E_WORKSPACE_NAME` for the test.
- Fixture namespace or identifier convention: fixture directories under `/tmp/paseo-e2e-fixtures/$RUNTIME_E2E_RUN_ID/`; agent titles prefixed `e2e-$RUNTIME_E2E_RUN_ID`.
- Required baseline data: at least one workspace with one agent that has finished a turn (needed for usage and context data).
- Cleanup command or procedure: `paseo daemon stop --home /tmp/paseo-e2e-home`, then `rm -rf /tmp/paseo-e2e-home /tmp/paseo-e2e-fixtures/$RUNTIME_E2E_RUN_ID`.
- Isolation/concurrency constraints: one E2E daemon per port; serialize runs that share port `6801` and home `/tmp/paseo-e2e-home`.
- Recovery procedure after interruption: run the cleanup command above; it touches only the E2E home and the run's fixtures.

## Evidence conventions

- Artifact root: `docs/testing/` per the runtime E2E skill, with Playwright output under `<plugin>/e2e/test-results/`.
- Screenshot/recording naming: `<plugin>-<case-id>-<viewport>-<theme>.png`.
- Runtime log references: `paseo plugin logs <id> --home /tmp/paseo-e2e-home --json` captured after each case, plus the `daemon.log` time window.
- Request evidence: WebSocket/RPC message name, plugin id, and timestamp; no prompt text or tokens.
- Retention or redaction rules: redact account emails shown in provider display names, prompt contents, and any credentials from logs and screenshots.

## Safety constraints

- All mutation stays on the E2E daemon and its fixture directories.
- Agents started by tests use the human's real provider plans and quota; keep prompts tiny and limit each run to at most 2 agent turns.
- Always run the cleanup command, including after failure.
- Ask the human before: touching `~/.paseo` or the default daemon, installing Playwright or browsers, starting more than 2 agent turns, or binding beyond `127.0.0.1`.

## Preflight

Before setting `Status: READY`, verify:

- every required service can start and exposes the documented ready signal;
- the selected environment is permitted and distinguishable from production;
- required variable names are documented and their values are available securely;
- authentication and fixture setup work;
- evidence can be captured at the documented locations;
- cleanup restores the environment to its baseline;
- commands use repository-relative paths where practical.

For this project, also verify that `paseo plugin ls --home /tmp/paseo-e2e-home` shows the plugin `running`
and that `paseo plugin ls` (default daemon) is unchanged before and after the run.

## Known limitations

- Playwright is installed only in `usage-pill/e2e/`.
- Start the E2E daemon from a normal terminal (Terminal.app or a Paseo terminal tab), not from the Paseo `/sh` runner: on 2026-11-04 daemons launched there received SIGTERM about 1 s after launch, while the same command in a normal terminal stayed up.
- Desktop-only surfaces (the built-in Paseo browser, the Electron shell) and native mobile clients cannot be driven from the web UI.
- Provider usage data depends on real accounts, so exact percentages are not deterministic.

## Playwright execution and audit

- Project root: `<plugin>/e2e/` (one Playwright project per plugin).
- Test/config/helper locations: `<plugin>/e2e/playwright.config.ts`, `<plugin>/e2e/tests/*.spec.ts`, shared helpers under `<plugin>/e2e/helpers/`. Add `e2e/` to the plugin's `tsconfig.json` `exclude` so `npm run typecheck` keeps checking only plugin code.
- Dependency/browser installation: `npm install -D @playwright/test` and `npx playwright install chromium` inside `<plugin>/e2e/`, only after human approval.
- Native execution command: `["npx", "playwright", "test"]` with `cwd` set to `<plugin>/e2e/` and `baseURL` `http://127.0.0.1:6801`.
- Evidence attachment policy: keep traces and screenshots for failed and approved cases; apply the redaction rules above.
- Persistence proof: page reload plus a fresh `paseo` CLI read against the E2E daemon.

Use the skill's suite contract and evidence tool described in `playwright-contract.md`.
Launch a separate browser per invocation rather than attaching to a shared CDP session.
Tests must emit structured checkpoint observations, not screenshot-only proof.

## Base instance

Used when a suite declares `base` to prove that new-behavior tests can fail.

- Base environment: `PASEO_HOME=/tmp/paseo-e2e-base-home` with the same `config.json` as setup step 1 but `daemon.listen` `127.0.0.1:6802`, started with `paseo daemon start --home /tmp/paseo-e2e-base-home`, plugin installed from the base worktree's plugin directory.
- Base setup: `["npm", "install"]` and `["npm", "run", "typecheck"]` in the base worktree's plugin directory.
- Base start limitations: revisions where the plugin directory does not exist yet cannot be installed; treat the plugin as absent.

## Existing test suites

| ID | Command (argument array) | Env | JUnit report |
| --- | --- | --- | --- |
| `typecheck` | `["npm", "run", "typecheck"]` with `cwd` `<plugin>` | NONE | NOT_SUPPORTED |
| `usage-pill-e2e` | `["npx", "playwright", "test"]` with `cwd` `usage-pill/e2e` | `E2E_WORKSPACE_NAME=<fixture workspace name>` | written to `usage-pill/e2e/test-results/junit.xml` by the config |

- No suites: NOT_APPLICABLE
- Smoke suite: `typecheck`.

## Regression

- Sources: `["<plugin>"]`, for example `["usage-pill"]`.
- Import aliases: NONE
- Shared surfaces: `["<plugin>/shared/**", "<plugin>/index.client.tsx", "<plugin>/index.server.ts", "<plugin>/paseo-plugin.json", "<plugin>/package.json"]`
- Fan-in threshold: 2
- Regression budget: 3

| Key route | Page file | URL to open in the sweep |
| --- | --- | --- |
| agent composer | `usage-pill/index.client.tsx` | `/` then open the fixture agent |
| Settings → Plugins | host UI | `/` then Settings → Plugins |

## Determinism

- Time freeze: browser-only via `page.clock`; the daemon and provider usage are not frozen.
- Seed data: NOT_SUPPORTED; fixture agents are created fresh each run.
- Randomness: NOT_SUPPORTED.
- Normalization rules: agent and workspace IDs `/(agt|ws)_[A-Za-z0-9]+/` to `<id>`; percentages `/\d+%/` to `<pct>%`; reset times `/resets \d+h \d+m|resets \d+m/` to `resets <t>`; emails in display names to `<email>`.
- Determinism limits: provider usage values, context-window token counts, and agent output text vary between instances.

## Parallel execution

- Isolation: serialized.
- Run marker: use `RUNTIME_E2E_RUN_ID` in fixture directory names and agent titles.
- Shared mutation lock: NOT_REQUIRED, because runs are serialized on the fixed E2E port and home.
- Ports/service ownership: `6801` (head) and `6802` (base) are owned and stopped by the run that started them; `6767` belongs to the human's daemon and is never touched.
- Interrupted-run recovery: stop the E2E daemon by `--home` and delete only that home and `/tmp/paseo-e2e-fixtures/$RUNTIME_E2E_RUN_ID`.

Unknown isolation means serialize mutation runs.
Browser contexts do not isolate database state or external side effects.
Never reset a shared database or stop services owned by another run.

## Security and performance probes

Used by `security-performance-check` for local/dev runtime probes.
Never put secret values here; name accounts and commands only.

- Allowed hosts: `127.0.0.1:6801` and `127.0.0.1:6802` only; probes stop on any other host, including `127.0.0.1:6767`.
- Test accounts per role: NOT_APPLICABLE; Paseo has a single local user, so ownership and role probes do not apply.
- Access-denied fingerprint: NOT_APPLICABLE without a daemon password.
- Data reset command: the cleanup command in Fixtures and cleanup.
- Probe budget: 20 probe requests per run; plugin RPC probes only, no agent turns.
