# agent-activity runtime evidence

Evidence from the E2E run on PR #3 (isolated Paseo 0.15.0 daemon, Claude Haiku 5.5).
It is a record of one run, not product authority; the intended behavior is in `docs/plans/active/agent-activity.md`.

## Contents

- `validate/expectations.json`: the expectations K1 to K10 taken from the plan's verification section.
- `validate/risk.json`: the risk classification of the PR at the tested head (`9916499`).
- `screenshots/{dark,light}/`: Brief, Steps, Full, one step opened, and plugin disabled, at desktop 1440 and compact 390.
- The Playwright tests that produced these are in `agent-activity/e2e/`.

## Result

- K1 to K9 passed. K10 produced the screenshots above; the compact screenshots were left for a human to review.
- No `report.md` or `status.json` was generated: the `validate-change` bundle needs a base instance run and tagged cases, which were not done.
- Not covered: reasoning steps, Codex, OMP, and the independent audit step.
- A later commit fixed the `1 step · 0s` run duration found during review; the screenshots predate that fix.
