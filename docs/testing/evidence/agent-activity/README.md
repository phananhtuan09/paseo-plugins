# agent-activity runtime evidence

Evidence from the E2E run on PR #3 (isolated Paseo 0.15.0 daemon, Claude Haiku 5.5).
It is a record of one run, not product authority; the intended behavior is in `docs/plans/active/agent-activity.md`.

## Contents

- `validate/expectations.json`: the expectations K1 to K10 taken from the plan's verification section.
- `validate/risk.json`: the risk classification of the PR at the tested head (`9916499`).
- `screenshots/{dark,light}/`: Brief, Steps, Full, one step opened, and plugin disabled, at desktop 1440 and compact 390.
- The Playwright tests that produced these are in `agent-activity/e2e/`.

## Result

Re-run on 2026-11-05 at head `41a7cba` plus uncommitted E2E test changes.
Daemon: isolated Paseo 0.15.0, Claude Haiku 5.5.

- Fixture agent turns, in order: reply `OK`, read and edit `notes.txt` and run a failing `ls`, then `sleep 8 && echo done` twice.
  The fixture directory has no git repository, so the sidebar workspace name equals the directory name.
  A fixture inside a git repository shows the workspace as `main` under the project row, which breaks `E2E_WORKSPACE_NAME`.
- Dark and light each ran the full suite: 7 passed and 3 skipped (the live K1 case and the daemon-wide K4 case on compact).
  K1 live passed on its own with `E2E_LIVE=1`, and the suite still passed after it added a third `sleep` run.
- `npm run typecheck` and 44 unit tests passed in `agent-activity/`.
- The 18 screenshots in `screenshots/` were regenerated at this head, so they show the spacing, phase colors and guide line.
- K5 accepts any non-zero exit: `ls` on macOS exits 1 and GNU `ls` exits 2, and the plugin shows the real code.
- K3 checks structure, not exact counts: the model may add a step in the first run, and the live case adds `sleep` runs.
  Each single-step run header must show at least 8 s (the observed values were 10 s to 12 s, because a run also includes the model's wait before the tool call).

## Findings

- The run header showed `1 step · 0s` for a single `sleep 8` step because a finished tool call is stamped when it ended.
  Fixed by starting the run at the entry before it (`before` in `client/segments.ts`).
  After the fix both single-step runs show `9s`, and the K3 test asserts `8s` to `10s`.
  The screenshots in `screenshots/` were regenerated after the fix.
- The compact screenshots were not reviewed by a human; one was viewed by the agent and showed no clipping.

## Not covered

- Syntax highlighting and the Bash command block: the fixture reads no code file and runs no long command, so only the unit tests (`highlight.test.ts`, `classify.test.ts`) cover them, plus a manual look on the human's own daemon.
- Reasoning steps, Codex, OMP, and the independent audit step.
- No `report.md` or `status.json`: the `validate-change` bundle needs a base instance run and tagged cases, which were not done.
