---
name: runtime-e2e-test
description: Plan and run real web and HTTP API runtime E2E acceptance or regression tests using Playwright scripts. Use for multi-case user flows, forms, authentication, permissions, persistence, async integrations, uploads/downloads, and approved visual baselines. Produce a human-reviewed Markdown plan, mapped executable tests, and auditable runtime evidence; never pass cases using screenshots alone, mocks, or source inspection.
argument-hint: "<scope> | plan <scope> | run <suite.json> | light <scope>"
---

# Runtime E2E Test

Encode actions and assertions in native Playwright Test scripts.
Use judgment to design coverage and investigate failures, not to manually drive or score automated cases.

## Mode selection

Choose the mode first. Both modes plan and run the same way, with the same evidence tool, statuses, and evidence rules; they differ only in two switches, durable storage (plan, `suite.json` and ledger in `docs/testing/`) and a separate human approval gate.

- **Durable** (both on), when any of these holds: the human asks to keep or re-run the tests or to use them for a release; the target is existing features with no change set; the work spans sessions or needs a later audit.
- **Light** (both off), when a composite validation step invokes this skill, or when there is a change set and the goal is to prove that change now.
- **Unclear: light.** A wrong light choice is cheap, because its evidence has the same quality and the run can be promoted afterwards; a wrong durable choice costs the human a plan review they did not need.

An explicit human instruction ("keep this test", "quick run only") overrides the choice.
Declare the choice in the suite as `mode` with `modeReason` naming the signal; the first line of the chat report states the mode and that signal.
Do not rely on the implementer's summary or PR description for intent or for what was tested; derive both from the human's request and the change itself, as `review-pr` does.
When `validate-change` invokes this skill, it supplies `expectations.json` (K1..Kn) and the review handoff `review.json`; use them instead of deriving intent again. Cover each K with at least one case that names it in an `expects` list, and name the review's flows and suspicions a case covers in `flows` and `suspicions` (for example `"expects": ["K1"], "flows": ["F1"], "suspicions": ["H1"]`). Derive intent cases from K, never from review findings or the implementer's summary.

Durable mode is `plan`, then explicit human approval, then `run`. Light mode does the same planning steps and runs straight away:

- The plan Markdown, `suite.json`, and bundle go under the project's evidence root (for example `.runtime-e2e/<slug>/light/`), never in `docs/testing/`; the tool refuses a light suite there. Tests go where the runner finds them, normally the runtime spec directory.
- There is no `approve` step; the tool refuses one. The run records that nobody approved the tests, and the report says so.
- The tool checks the environment before a light run, because there is no approval gate to catch it: a production-like host or a real-looking credential in the suite's env or files stops the run. Ask the human; rerun with `--confirm-environment` only after they confirm. Weaker signals, such as a shared staging host, are recorded as limits.
- After reporting, delete the light tests unless the human wants them kept; the bundle keeps their snapshot. To keep some, `scripts/evidence.py promote <run-dir>` restores the exact files and writes a durable plan and suite in `docs/testing/active/` without rediscovery; remove the unwanted cases, validate, and ask for approval as in durable mode.

## Source of truth

Read `docs/testing/README.md` before creating, executing, resuming, or auditing a plan. Store active plans in `docs/testing/active/` and useful completed plans in `docs/testing/completed/`.

Validate the artifact with:

```bash
python3 .claude/skills/runtime-e2e-test/validate_test_plan.py <plan.md> --mode plan
python3 .claude/skills/runtime-e2e-test/validate_test_plan.py <plan.md> --mode completion --bundle <run-dir>
```

After every run, whatever its outcome, validate the ledger with `--bundle <run-dir>`. It checks `Run ID`, `Tested revisions` and `Last updated` against the recorded run, each case's `Result`, `Can-fail` and `Actual path`, and each existing suite's status against the generated results. Add `--fill` to copy those generated fields (and the run summary counts) from the bundle into the ledger first, instead of typing them; `Observed`, `Evidence`, `Cleanup`, `Path match`, `Status` and the sign-off stay yours to write.
Use `--mode completion` only when claiming completion; for a `FAILED` or `BLOCKED` ledger use `--mode plan --bundle <run-dir>`, since completion mode also reports the unresolved cases.

Runtime adapters rewrite the skill path when installed.

## Project runtime reference

Before planning or execution, read
`.claude/skills/runtime-e2e-test/references/project-runtime.md`. This file is a
project-local template that maintainers customize after installation with the
actual service commands, readiness signals, environment profile, required
variable names, authentication, fixtures, evidence locations, cleanup, and safety
constraints.

Treat the reference as operational configuration, not product authority. Never
execute placeholder commands or invent environment values. `Status: READY` means
the project has verified the documented preflight. If the file is missing or
unconfigured, inspect existing repository configuration and runbooks for facts
you can establish safely. Record unresolved runtime prerequisites as blockers;
never compensate with a lower-level or mocked path. Never write secret values into
the reference or a test plan.

## Scope and boundaries

Support browser web flows and real HTTP APIs through Playwright Test, including runtime observations of permitted downstream state.
Native mobile/desktop, CLI-only systems, hardware, load benchmarks, and comprehensive security testing are outside this capability.
Subjective UX needs human review; screenshot comparisons need an approved baseline.
Coverage means the declared cases, not a claim that the application has no bugs.

Read `references/playwright-contract.md` before writing tests or running a suite.
Reuse existing Playwright config, fixtures, and helpers.
If setup is absent, propose minimal dependencies/config for approval before installing or changing them.
Do not build a custom browser runner or JSON action DSL.

Use this capability when verification has multiple cases, crosses runtime boundaries, must survive sessions, needs fixtures or cleanup, includes release blockers, or needs later audit. Use light mode for proving a change now; create a durable plan only when a durable signal above holds.

A runtime case exercises the running system through its real user or operational entrypoint. Unit, widget, mocked, static-analysis, build, and source-inspection checks may supplement a run, but they never make a runtime case pass. List each one under `## Supporting checks` with its own result (`PASS`, `FAIL`, or `NOT_RUN` with the reason), never only in prose, and report every listed check that did not run. The project's own test suites are not supporting checks: declare them as existing suites so the tool runs them on base and head.

Interactive browser tools may discover selectors or debug a failure, but cannot replace script execution or score an automated case.
The fixed constraints are:

1. Exercise the declared runtime path.
2. Observe the declared outcome.
3. Record clear evidence.
4. Never convert unavailable or alternate-path proof into `PASS`.

## Mode: `plan`

In light mode, follow these steps except the approval in the last one, then continue with `run`.

1. Read the project runtime reference, current request, and the smallest relevant product, domain, architecture, code, configuration, and runtime surfaces.
2. Derive cases from observable behavior, boundaries, failures, and material negative paths. Classify each case as `new-behavior` (must fail on base) or `invariant` (expected to pass on base too); keep at least one `invariant` case as a base health probe.
   Then walk `references/blind-spots.md` for the affected flows: apply its generators (input, state, interruption, viewport) and invariants, and declare every catalog item in the suite's `blindSpots` as applied by named cases, skipped with the reason, or a question for the human when the right answer is undecidable (for example truncate or wrap). Never turn an undecidable item into a defect.
3. When validating a change, list the tests the change adds or modifies and declare each as a `pr-test` case so the run shows whether it can fail on base. A PR test never replaces a runtime case; it only proves or disproves its own ability to fail.
   When the reference has a `## Regression` section, declare `regression` from it and run `scripts/impact.py <suite.json>`. Add an `invariant` case for each selected route that no case covers yet, listing it in the case's `routes`; derive it from what the route already did before the change, and state the map's reason for it in the case's notes. Keep the map's `notTested` routes and warnings as they are; never trim them. Add one `sweep` case over the reference's key routes.
4. Trace each release-blocking case far enough to name the real production path: user action or operational trigger, runtime entrypoint, boundary request, and persisted or visible outcome.
5. Separate agent-verifiable behavior from subjective human judgment.
6. Define isolated fixtures, authentication, cleanup, environment restrictions, and concurrency safety.
7. Write native Playwright tests and a `suite.json` contract mapping every case to one uniquely tagged test (or, for a `pr-test`, its file and title) and its required checks. Declare the base revision (normally the merge base with the target branch) and the base instance's environment from the project runtime reference. Declare `determinism` from the same reference: frozen time, seed data, and stubbed randomness where supported, normalization rules for IDs and timestamps, and every unsupported item as a limit. Declare `mode`, `modeReason`, and `blindSpots` as chosen above. Declare `existing` from the reference too: every test suite the project has (unit, integration, e2e), whole and unfiltered, with a JUnit report where the runner supports one; only when it has none, the reason.
   Declare them even when no base instance can run: the tool then runs them on head only, a passing suite reports `PASS`, and a failing one `NOT_COMPARABLE`.
   When the Playwright project lives below the evidence root, set `cwd` to its directory instead of absolute binary or config paths in `command`.
8. For each expected outcome, name the assertion and observation source. Persistence claims require a fresh persisted-state observation; a successful response or toast is insufficient.
9. Capture baseline values before mutation when proving invariants such as unchanged totals. Assert the final UI after reload and persisted state separately where both are required.
10. Use real controls, stable unique locators, event-based waits, and bounded timeouts rather than arbitrary sleeps. No mocked production boundaries. Measure layout, such as whether text wraps, with the helpers in `references/playwright-contract.md`, and record the measured number as the check's actual value.
11. Mark `READY` only when paths, expectations, scripts, and required evidence are reviewable. Validate the Markdown and suite contracts.
12. Durable mode: stop and ask the human to review the plan, tests, fixtures, config, and commands. Record approval only after an explicit decision, using the evidence tool's `approve` command. Light mode: run now.

Include imported local helpers, fixture modules, relevant dependency lockfiles, config, and visual baselines in approved files.
Any change to approved files, steps, assertions, or expected values invalidates approval.
Planning may use read-only inventory; do not exercise mutation flows until approved execution.

Do not freeze an implementation detail unless it identifies the production path or observable contract. If several valid runtime methods exist, describe the required boundary and outcome rather than one exact tool command.

## Mode: `run`

1. Read the entire plan, project runtime reference, and current repository authority.
2. Run the documented preflight where needed; do not start against a prohibited or unidentified environment.
3. Record the environment and configuration identity without storing secrets. The tool generates the run ID and records the head and base commits and start/finish times in `run-manifest.json`. Copy them from there into the ledger.
4. Check approval (durable mode) and snapshot the declared files, then execute through `scripts/evidence.py run`. Launch independent browsers; never attach to a shared Chrome DevTools MCP/CDP session. When the suite declares a base, the tool runs the same approved tests against the base revision in a separate worktree and app instance.
5. Let Playwright drive the declared path and assert observable outcomes. Fresh contexts isolate sessions; run-marked fixtures isolate data. Serialize shared mutations or acquire the project lock before execution.
6. Use the tool-generated native results, observations, attempts, trace, cleanup, and summary. Never hand-edit evidence or generated reports. Copy each case's `Actual path` from its recorded observations, then set `Path match` by comparing it with the case's `Runtime path`: `YES` only when both name the same entrypoint, boundary and outcome.
7. Mark:
   - `PASS` only when the declared runtime path and expected outcome were observed.
   - `FAIL` when the path runs and the outcome differs.
   - `BLOCKED` when the required runtime path cannot be exercised.
   - `INVALIDATED` when accepted intent changed and the old case no longer represents the required behavior.

   Copy each case's generated `Can-fail` value into the ledger:
   - `PROVEN`: fails on base and passes on head.
   - `NON_PROVING`: a `new-behavior` case that passes on base too. It is not a passing case and keeps the suite from completing; report it as a test that does not prove the change. Strengthening the test or reclassifying the case requires reapproval.
   - `NOT_PROVEN`: no base was declared, the base run degraded, the case was flaky on base, or the base failure disappears once IDs and timestamps are normalized; state "ability to fail not proven" and the reason. For the normalization cause, check that the normalized field is noise and not the behavior under test; if a rule hides the behavior, narrow the rule and reapprove.
   - `NOT_REQUIRED`: an `invariant` case.

   Copy each existing suite's generated status into `## Existing suites` as `- <id>: <status> — <note>`, naming its new, unstable, removed and pre-existing tests:
   - `NEW_FAILURE`: passes on base, fails on head twice. Report it as a failure of the change; the suite status is `FAILED`.
   - `NEEDS_REVIEW` or `NOT_COMPARABLE`: an unstable or removed test, or results that cannot be compared. Report them for the human; completion needs an accepted sign-off.
   - `PRE_EXISTING`: fails on base too. Report it separately as an earlier failure, never as a failure of the change, and never hide it.
8. Do not fix application code in this mode. Preserve failures and report them for a separate authorized fix. Test/config changes require reapproval and a new run; rerun the same case after a fix.
9. Complete cleanup and record its status.
10. Update the run summary and set the suite status:
   - `FAILED` or `BLOCKED` while material cases remain unresolved.
   - `AWAITING_HUMAN` when machine-verifiable cases pass but subjective review, an existing suite's review, a sweep difference, or a blind-spot question remains.
   - `COMPLETED` only after required human sign-off is accepted.
11. Audit the bundle and run the Markdown validator in `completion` mode before claiming completion. Copy the audit's `Audit:` line into the run summary and report it as written: exit 1 means the evidence is consistent and cases remain unresolved; only exit 2 means the evidence is inconsistent or unreadable. Update the Markdown ledger from generated results, linking the immutable run summary; never invent observations, counts, or times. Set `Last updated` from `date -u +%Y-%m-%dT%H:%M:%SZ` at the moment you write the ledger, then run the validator with `--bundle` (`--mode plan` for a `FAILED` or `BLOCKED` ledger).

Report the generated determinism limits, or that determinism was not declared, among the run's limits.

`run` also writes `report.html` in the bundle, one offline file for the human reviewer. To add cause explanations, write them to a notes JSON outside the bundle (`{"<case ID>": "...", "general": "..."}`) and regenerate with `scripts/evidence.py report <run-dir> --notes <file>`; they appear labeled as agent inference. In chat, give a short Markdown summary and the report's path.

Report the blind spots from the generated summary: items applied with their cases' results, items skipped with the reason, and each question for the human.

Report the impact map and sweep from the generated summary: selected routes with their reasons, routes found but not tested and why, shared surfaces and untraced files, and every swept route that differs, with both screenshots. A sweep difference is a finding for the human, also when it is marked "may belong to intent"; never call it expected yourself.

A degraded base run is reported with the reason the tool recorded; never compare against nothing or describe a degraded run as proven.

Do not silently resume by reusing earlier PASS results for a changed revision or environment.
Each invocation is a separate run; partial suites require an explicitly narrowed, reviewed contract and never count as full coverage.

## Path fidelity

An alternate endpoint, direct database mutation, lower-level method, test double, or automation-only shortcut is not the declared production path unless the case explicitly targets it.

If the production path changes because accepted behavior changed, revise the case and note why. Do not revise a path merely because another path is easier to test.

## Evidence

Evidence must let another session determine what actually ran without replaying the entire conversation. Prefer stable repository-relative paths and identifiers:

- browser screenshot or recording path
- request method, route, and status
- correlation or trace ID
- runtime log path and relevant timestamp
- persisted resource ID and observed post-reload state
- generated file or exported document path

Every machine-verifiable expected outcome needs a mapped assertion and structured observation.
Screenshots supplement this proof; their existence is not a passing criterion.
Keep native results and all retry attempts. A retry-pass is reported as flaky, not silently counted as a clean PASS.
Retain sanitized traces for browser cases, and structured request/state evidence for API-only cases.
Avoid sensitive payloads in trace capture; establish redaction before execution and never upload artifacts without authorization.

Never copy secrets, tokens, cookies, passwords, or production-sensitive payloads into the plan.

## Human sign-off

Keep human review small: point the reviewer to the bundle's `report.html`. The reviewer checks:

1. Summary counts and release blockers.
2. `Runtime path` versus `Actual path` for important cases.
3. Evidence for failures, blockers, and subjective UI/UX cases.
4. The running product directly where judgment is subjective.

The agent may prepare the sign-off section but must never set `Decision: ACCEPTED` without an explicit human decision.

## Evidence audit (within either mode; not a third mode)

For an existing plan:

1. Run `scripts/evidence.py audit <run-directory>` and the Markdown validator.
2. Read the approved plan and test snapshots, not just the summary or PASS flags.
3. Match expected → assertions → runtime path in trace/request checkpoints → actual observations → native results. Inspect every release blocker, failure, skipped/flaky case, and suspicious PASS.
4. Verify baseline/invariant checks, persisted state, fixture identity, and cleanup. Screenshot-only claims are unsupported.
5. Classify claims as `SUPPORTED`, `UNSUPPORTED`, `INCONSISTENT`, or `HUMAN_REVIEW_REQUIRED`. Mechanical validation is necessary but cannot establish assertion quality or semantic path fidelity.
6. Request targeted reruns only for missing, contradictory, stale, or insufficient evidence. Unsupported proof is not itself a product bug.

Hashes detect changes relative to the approved snapshot; they do not prove execution authenticity against a dishonest producer.
Use independent CI logs/artifact storage when stronger provenance is required.
