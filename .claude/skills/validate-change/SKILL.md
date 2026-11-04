---
name: validate-change
description: Opt-in command, started only when the human invokes /validate-change, that validates a PR, branch, or diff in one run. It builds one expectation list from the human's prompt or spec, gates risky changes once, then runs quality-code-check, review-pr, and runtime-e2e-test light mode on that list and reports one status. It never modifies application code.
argument-hint: "[PR | branch | diff] [intent prompt or spec path] [--gate=always|never]"
disable-model-invocation: true
---

# Validate Change

A thin orchestrator for the Validate phase. It performs no checks itself: it fixes intent once, decides whether the human must confirm it, hands the same expectation list to each specialist skill, and turns their results into one status with `scripts/validate_change.py`.

Each underlying skill stays independently usable, and this command is never part of a required chain: the human invokes it, and other work never waits on it.

## Boundaries

- Never modify application code, tests, configuration, or the reviewed change. Fixes go back to Implement; then run this command again.
- Run every step in non-fixing mode. `runtime-e2e-test` light mode writes its temporary tests and bundle as that skill describes; nothing else is written outside the run directory.
- Never run against production, and never validate without a change set; for existing features with no change, use `runtime-e2e-test` directly.
- Write the report in Vietnamese. Preserve identifiers, paths, commands, and quotes.

## Run directory

Use `<evidence root>/<slug>/validate/`, under the evidence root that `runtime-e2e-test/references/project-runtime.md` declares (for example `.runtime-e2e/<slug>/validate/`). The light runtime suite goes beside it in `<slug>/light/`.

| File | Written by | Holds |
| --- | --- | --- |
| `expectations.json` | this skill | K1..Kn and conflicts |
| `risk.json` | `validate_change.py risk` | risk signals, gate, audit requirement |
| `run.json` | this skill | gate answer, steps, `Cần test riêng`, limits |
| `review.json` | `review-pr` | the review status and the handoff |
| `audit-input.json` | `validate_change.py audit-input` | what the auditor may see |
| `audit.json` | the auditor | one verdict per K |
| `report.md`, `status.json` | `validate_change.py report` | the overall status and the report |

Never hand-edit a generated file. The tool recomputes `risk.json` from the diff and refuses a stale or edited one.

## 1. Scope and expectations

Resolve the change set as `review-pr` does (PR, refs, range, or working tree), and record the base ref.

Build exactly one expectation list in `expectations.json`; every later step consumes it and none derives intent again:

```json
{
  "schema": "validate-change/expectations@1",
  "items": [
    {"id": "K1", "statement": "A non-owner opening /orders/:id sees 404", "change": "added",
     "source": "prompt", "sourceRef": "prompt", "quote": "người khác mở đơn thì báo không tìm thấy", "confirmed": "source"},
    {"id": "K2", "statement": "The order list still sorts newest first", "change": "unchanged",
     "source": "assumption", "sourceRef": "diff:src/orders/list.ts", "default": "keep the current order", "confirmed": "none"}
  ],
  "conflicts": [
    {"id": "C1", "items": ["K3", "K4"], "summary": "prompt says max 10%, spec says 15%", "resolution": "unresolved"}
  ]
}
```

- One observable behavior per item, written in the prompt's language, so a case can prove it and an auditor can judge it.
- `change`: `added`, `modified`, or `removed` for what the change should do; `unchanged` for behavior it must keep, which feeds the regression pillar.
- `source`:
  - `prompt` or `spec`: the human's words, with `quote` verbatim and `confirmed: source`.
  - `assumption`: a point the sources leave open, with the `default` you chose.
  - `agent-intent`: behavior only the implementer's account or the diff suggests. The PR description is never an intent source: anything taken from it is `agent-intent` with `sourceRef: pr-description`.
- When the prompt and the spec disagree, keep both items and record the conflict. Never pick one silently.
- Read the PR description before the gate. A claim that it does something "as requested" (or otherwise on the human's behalf) that contradicts a K becomes an `agent-intent` item with `sourceRef: pr-description` and a conflict with that K, so the gate shows it.
- Ask nothing yet; the gate asks once.

## 2. Risk gate

Run `python3 <skill-dir>/scripts/validate_change.py risk <run-dir> --base <ref>` (add `--worktree` for uncommitted changes; untracked files then count as added).
It applies `references/risk-rules.md`, a project-editable table of deterministic gate and audit signals: money, data, and permission paths and tokens, deleted or skipped tests, size, shared files, environment variables, major dependency bumps, agent-intent only, and recorded conflicts.

When `security-performance-check` is installed beside this skill, the same risk step also reads the hint columns of that skill's `references/security-signals.md` and `references/performance-signals.md` (path hints and content hints, for any language or framework), matches them on the diff's files and changed lines, and writes `separateTests` into `risk.json` with a ready command per hinted row (for example `/security-performance-check security`).
A content hint on a changed line decides it (a Django `redirect(request.GET["next"])` or a Blade `{!! $bio !!}` counts wherever the file lives); prose files such as `*.md` never count.
A path hint alone counts only for a file with no changed text (binary or mode-only) or a row with no content hints, because directory globs such as `**/app/**` match every file of some frameworks.
Those signal files stay the single source of truth: this skill does not copy their rows.
When the skill is not installed, `separateTests` in `risk.json` is empty and detection is skipped.
The risk step writes each command without the target label; the report step appends that label when copying into `run.json`.
A `risk.json` written before this signal detection existed has no `separateTests` key: with the skill installed, `report`/`evaluate` treats that as stale and requires re-running `risk`.

- Gate required (any `high` or `gate` signal, or `--gate=always`): stop once and send one message that lists K1..Kn, the conflicts, the assumptions, and the flows you plan to test, with the signals that fired. The human confirms, edits, or picks conflict resolutions in that one answer.
  - Confirmed: set `confirmed: gate` on every assumption and agent-intent item, write the chosen item into each conflict's `resolution`, and record `answer: confirmed`.
  - Edited: apply the edits; an item the human adds is `source: prompt` with `sourceRef: gate`, their words as `quote`, and `confirmed: source`. Set `confirmed: gate` on every assumption and agent-intent item that remains, as for a confirmation, and record `answer: edited`.
  - No human can answer (a headless run): record `answer: no-human`, mark the three steps `SKIPPED` with `skip: no-human`, and report. The status is `NEEDS_HUMAN`; never continue on your own.
- Gate not required: run straight through. Assumptions stay `confirmed: none` and the report lists them with their defaults.
  After the report, never ask, advise, or list as a next step that the human confirm or adjust them.
- `--gate=never` records `override: never`; the report shows it as a human waiver beside the computed risk, which does not change.

The audit in step 6 is required when any `high` signal fired.

## 3. Static checks

Load `quality-code-check` in non-fixing mode, including its surface review when installed. Record each command with its kind (`build`, `lint`, `typecheck`, `test`, `surface`) and exit code in the `quality-code-check` step.
When `quality-code-check/scripts/surface-scan.cjs` is installed, `report` rejects a run without a `surface` check.

- A failing build stops before runtime: record `runtime-e2e-test` as `SKIPPED` with `skip: build-failed`.
- Lint and type failures do not stop review or runtime.

## 4. Review

Load `review-pr` with the target, the base, and `expectations.json` as its intent basis, and ask for its composite handoff in `<run-dir>/review.json` (its section "Called from validate-change"). It still writes its normal review in the conversation.

## 5. Runtime

Load `runtime-e2e-test` in light mode with `expectations.json` and `review.json`. Its cases come from three pillars:

- Intent: at least one case per K, naming it in the case's `expects`. Derive cases from K, never from review findings or the implementer's summary.
- Regression: the impact map, `unchanged` items, and the review's flows, named in `flows`.
- Edge cases: the blind-spot catalog and the review's suspicions that need runtime proof, named in `suspicions`.

A sweep difference is never yours to call expected.
The report script accepts it only when it is the run's only open item, adds no console error, and each differing route is covered by a passing, proving case for an expectation the human confirmed (`confirmed` is `source` or `gate`); the report then lists it as a note with both screenshots.
Route coverage does not prove the rest of the page, so the human still looks at the screenshots.
Any other difference keeps the run at `NEEDS_REVIEW`.
A K's coverage `FULL` means its cases pass; when the K is `added` or `modified` and none of its cases has can-fail `PROVEN` (no base, or a base that could not prove it), the report adds that K to `Giới hạn`.

Skip this step with `skip: not-applicable` when the change has no runtime surface the skill supports, and say why.

While reading the run's traces and observations, note passive signals for `Cần test riêng` that the signal-file match did not already cover: more requests than the base run when the suite declares a base, duplicate requests, slow responses, large payloads, and new console warnings. Run axe on the changed pages only when the project already has `@axe-core/playwright`; otherwise state the limit. Never install it.

## 6. Independent audit (high risk only)

Run `validate_change.py audit-input <run-dir>`, then start one subagent with a fresh context. Give it only `audit-input.json` and the runtime bundle path; never the PR description, the review, `run.json`, or your own summary.
It reads each K and the evidence files and writes `audit.json`:

```json
{"schema": "validate-change/audit@1", "verdicts": [
  {"k": "K1", "verdict": "SUPPORTED", "evidence": [{"file": "results.json", "locator": "cases[E2E-01].observations.checks.status"}], "reason": "..."}
]}
```

- `SUPPORTED`: the cited evidence shows the behavior.
- `CONTRADICTED`: the cited evidence shows the opposite.
- `UNSUPPORTED`: evidence exists but does not establish the behavior.
- `MISSING`: no evidence covers it.

Evidence files are paths inside the bundle; the tool rejects anything else. If the runtime offers no subagent, record the audit step as `MISSING` and say so.

## 7. Report

Write `run.json`:

```json
{
  "schema": "validate-change/run@1",
  "target": {"label": "PR #12"},
  "gate": {"override": null, "answer": "confirmed"},
  "steps": [
    {"skill": "quality-code-check", "status": "RAN", "checks": [{"kind": "build", "command": "npm run build", "exit": 0}]},
    {"skill": "review-pr", "status": "RAN", "artifact": ".runtime-e2e/orders/validate/review.json"},
    {"skill": "runtime-e2e-test", "status": "RAN", "artifact": ".runtime-e2e/orders/light/runs/<run-id>"},
    {"skill": "audit", "status": "RAN", "artifact": ".runtime-e2e/orders/validate/audit.json"},
    {"skill": "security-performance-check", "status": "SKIPPED", "skip": "recommended", "reason": "separateTests lists security or performance signals"}
  ],
  "separateTests": [{"area": "security", "signal": "object-id-access: src/orders/get.ts", "command": "/security-performance-check security PR#12"}],
  "limits": []
}
```

- Steps appear in this order, each once. The three specialist steps are required; record a missing skill as `MISSING`, never leave it out.
- `security-performance-check` is optional and never changes the overall status. Record it as `MISSING` only when the skill is not installed. When it is installed, record `SKIPPED` with `skip: recommended` if `separateTests` is nonempty, or `skip: no-signal` if it is empty. Do not run the full check from this composite.
- Start `separateTests` from `risk.json` (signal-file matches when the skill is installed). Append the target label to each ready command (for example `PR#12`). Add any extra passive runtime or accessibility notes that are not already covered. They are prompts for a human decision, never defects, and never change the status.
- `report` refuses a `run.json` that drops a `risk.json` match or records an installed `security-performance-check` as `MISSING`.

Then run `validate_change.py report <run-dir>`.
It checks every file against its contract and the current head, verifies the runtime bundle with the runtime tool, and computes the status, worst first: `NEEDS_HUMAN`, `BLOCKED`, `FAILED`, `NEEDS_REVIEW`, `PASSED`.
Exit 2 means the run files are inconsistent: fix the file it names, never the report.

In chat, give the report's first lines as written (status, reasons, gate, audit), the path to `report.md`, the path to the runtime `report.html`, and the questions the report asks the human; add no others.
When intent was never confirmed by a human, the report opens with that line; keep it first.
A bug found later in a run that reported `PASSED` is recorded with `record-workflow-friction` (category `escaped-bug`), not by reopening this command.
