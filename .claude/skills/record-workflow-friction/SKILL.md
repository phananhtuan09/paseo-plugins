---
name: record-workflow-friction
description: Record any observable problem, blocker, ambiguity, retry, rework, workaround, human correction, tool failure, runtime issue, task-context issue, workflow friction, or bug that escaped a validate-change run. Use only when the human explicitly asks to note, capture, or log the current execution difficulty, or reports that a bug got past a validate run, for later analysis. Do not assume the workflow caused the problem, and do not fix or replace the active task.
---

# Record Workflow Friction

Capture one concise, durable observation about agent execution without interrupting or evaluating the active task.

## Scope

Record friction even when it is not clearly a workflow problem. The observation may concern:

- workflow instructions, gates, artifacts, or handoffs
- model understanding, decisions, or execution
- runtime, tool, command, or integration behavior
- environment or external state
- task ambiguity or missing context
- human-agent coordination
- a bug that a `validate-change` run passed
- unknown cause

The workflow name and phase may be `unknown`. Do not force a workflow attribution.

## Boundaries

- Run only after an explicit human request.
- Record observable facts separately from hypotheses.
- Do not expose chain-of-thought, secrets, credentials, or unnecessary transcript content.
- Do not diagnose, fix, or redesign the workflow or active task.
- Do not label the issue as workflow-caused without evaluation evidence.
- Do not edit `update_target` or any other catalog, signal, or instruction file. Propose the lesson only; the human confirms it when reviewing the proposed update.
- After recording, return to the active task unless the human asks to stop.

## Procedure

1. Identify the active task, runtime, session, workflow or skill when known, and current execution context. Use `unknown` when unavailable.
2. Describe expected behavior, observed friction, first visible divergence, practical impact, extra work, human intervention, and current state.
3. Choose an `observation_scope` without claiming root cause: `workflow`, `model-execution`, `runtime-tool`, `task-environment`, `coordination`, or `unknown`.
4. Add direct evidence references such as a session, command result, tool result, file, artifact, or human correction. Do not invent evidence.
5. When the human reports a bug that escaped a validate run, set `category: escaped-bug` and fill the escaped-bug fields below. Choose `escape_class` as a hypothesis from the escape-class table; the human confirms it later.
6. Write one Markdown artifact to:

```text
docs/evaluation/observations/YYYY-MM-DD-{subject}-{short-slug}.md
```

If the path exists, add a numeric suffix. Keep one observation per file.

## Artifact Format

```md
---
phase: agent-execution-observation
schema_version: ai-agent/observation-v2
status: agent-reported-observation
recorded_at: YYYY-MM-DDTHH:MM:SSZ
subject: task-or-workflow-name
observation_scope: unknown
workflow_name: unknown
workflow_version: unknown
workflow_phase: unknown
runtime: claude
model: unknown
session_reference: unknown
task_class: unknown
category: rework
outcome_state: in-progress
human_intervention: unknown
---

# Agent Execution Observation: Short title

## Task Context
What the agent was trying to accomplish when the friction occurred.

## Expected Behavior
The observable behavior expected from the agent, workflow, tool, or environment.

## Observed Friction
What actually happened. Keep this factual and concise.

## First Visible Divergence
The earliest observable point where execution began differing from the expected behavior, or `unknown`.

## Impact
How the friction affected outcome, progress, quality, safety, cost, or human effort.

## Extra Work or Recovery
Visible retries, repeated reads or commands, rework, recovery, workaround, or coordination cost. Use `unknown` when it cannot be measured.

## Human Intervention
What the human had to clarify, correct, approve, repair, or redirect, or `none observed`.

## Workaround or Current State
The workaround used and whether the task recovered, remains blocked, or completed with friction.

## Evidence References
- `path-command-session-or-tool-reference`, or `unavailable`

## Agent Attribution Hint (Unverified)
Optional suspected source. Keep it separate from facts and do not present it as root cause.
```

When `category` is `escaped-bug`, also include these frontmatter fields and the escape-analysis body section:

```md
---
phase: agent-execution-observation
schema_version: ai-agent/observation-v2
status: agent-reported-observation
recorded_at: YYYY-MM-DDTHH:MM:SSZ
subject: task-or-workflow-name
observation_scope: unknown
workflow_name: unknown
workflow_version: unknown
workflow_phase: unknown
runtime: claude
model: unknown
session_reference: unknown
task_class: unknown
category: escaped-bug
validate_run: .runtime-e2e/<slug>/validate/report.md
validate_status: PASSED
found_by: human
escape_class: regression-miss
update_target: runtime-e2e-test/references/project-runtime.md
upstream_candidate: no
outcome_state: in-progress
human_intervention: unknown
---

# Agent Execution Observation: Short title

## Task Context
...

## Escape Analysis (Unverified)
How to reproduce the bug.
Which validate step should have caught it and why it did not (quote the report or evidence when possible).
The proposed concrete addition (the row / item / rule text) for `update_target`.
Do not edit that file from this skill.
```

## Categories

Use a short category such as:

- `misunderstanding`
- `missing-clarification`
- `unnecessary-question`
- `premature-action`
- `assumption`
- `decision-error`
- `repeated-read`
- `repeated-command`
- `retry-loop`
- `rework`
- `human-correction`
- `instruction-conflict`
- `unused-artifact`
- `tool-failure`
- `runtime-gap`
- `environment`
- `blocker`
- `safety`
- `escaped-bug`
- `other`

## Escaped-bug fields

Required only when `category` is `escaped-bug`:

| Field | Values |
| --- | --- |
| `validate_run` | Path to the run's `report.md` / run dir, or `unavailable` |
| `validate_status` | Status that run reported (`PASSED`, `NEEDS_REVIEW`, …), or `unknown` |
| `found_by` | `human` \| `production` \| `later-run` |
| `escape_class` | One value from the escape-class table |
| `update_target` | Installed project copy path named by that class, or `none` for `unknown` |
| `upstream_candidate` | `yes` \| `no` |

`escape_class` is a hypothesis. Keep it under `## Escape Analysis (Unverified)` and do not claim root cause.

### Escape classes and update targets

| `escape_class` | Meaning | `update_target` (installed copy in the project) |
| --- | --- | --- |
| `regression-miss` | An affected or shared flow broke and was not run | Smoke suite or `Shared surfaces` in `runtime-e2e-test/references/project-runtime.md` |
| `edge-case-miss` | Boundary, state, interruption or viewport case not covered | `runtime-e2e-test/references/blind-spots.md` |
| `security-performance-miss` | Security or performance issue not flagged | `security-performance-check/references/security-signals.md` or `performance-signals.md` |
| `evidence-gap` | A case passed on evidence that did not prove the behavior | Proving / verdict rules in `runtime-e2e-test` (`SKILL.md` Evidence section, `scripts/evidence.py`) |
| `surface-miss` | Code-surface problem the scan missed | `quality-code-check/references/surface-rules.md`, as a regex row when mechanically detectable |
| `intent-miss` | Intent was misread or a PR-description claim was accepted | `review-pr` / `validate-change` instructions; always `upstream_candidate: yes` |
| `unknown` | Cause not determinable from the evidence | `none`; record only |

### Where lessons land

- Default: the project's installed copy. `update --apply` keeps locally modified files by hash.
- Lessons that would help any project get `upstream_candidate: yes`; the human later opens a PR to this repo for them. Never push project-specific rules upstream automatically.
- No automatic edits to any catalog; every update goes through normal review.

## Evidence Rule

The artifact is discovery evidence with status `agent-reported-observation`. It does not prove a workflow failure or root cause. `workflow-evaluation` must corroborate it with session traces, tool or artifact evidence, human correction, repeated observations, or controlled exercise before upgrading its evidence status.

Observation counts do not establish a failure rate without a known session denominator.

## Done When

- one observation exists in `docs/evaluation/observations/`
- facts, impact, and unverified attribution are separated
- first divergence and extra work are recorded or marked `unknown`
- missing evidence is marked `unavailable`
- when `category` is `escaped-bug`, the escape fields and `## Escape Analysis (Unverified)` are present, and no `update_target` file was edited
- the active task was not modified by this skill
