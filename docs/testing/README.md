# Runtime E2E Test Plans

This optional namespace stores durable runtime end-to-end acceptance and regression plans.

## Admission

Create a plan here only for durable runtime verification: the human asks to keep or re-run the tests or to use them for a release, the target is existing features with no change set, or the work spans sessions or must be auditable later. A light run that proves a change now keeps its plan and evidence outside this namespace; `evidence.py promote` moves a light run here when its tests should be kept.

A plan is execution memory, not product authority. Derive expected behavior from the current request and approved product or decision sources.

## Locations

- `docs/testing/active/<slug>.md`: ready, running, failed, blocked, or awaiting human review.
- `docs/testing/completed/<slug>.md`: completed plans whose evidence remains useful.

Delete routine completed plans when their history has no future reader.

## Required document shape

Use one Markdown file for the plan, execution ledger, summary, cleanup, and human sign-off. Free-form notes are allowed around the required fields.

The Markdown file is accompanied by a `suite.json` mapping and native Playwright test files.
Read the installed `runtime-e2e-test/references/playwright-contract.md` for their contract and evidence-tool commands.
Human approval covers the plan, suite, executable tests, local helpers, fixtures, dependency/config files, and baselines before execution.
Any change to approved inputs requires explicit reapproval.
The Markdown ledger summarizes generated evidence; it does not replace native results.
After a run, copy `Run ID` and the head and base commits into `Tested revisions` from the bundle's `run-manifest.json` files, and take `Last updated` from the clock when you write the ledger, never an estimate.
Copy each case's `Actual path` from its recorded observations and judge `Path match` against that case's `Runtime path`. Copy the audit's `Audit:` line into the run summary.
Copy each existing suite's generated status into `## Existing suites`; a `PRE_EXISTING` suite is reported as an earlier failure, not as a failure of the change.
Copy each case's generated `Can-fail` value into the ledger; completion requires it on every PASS. A PASS whose `Can-fail` is `NON_PROVING` is counted under `Non-proving` in the run summary, not under `PASS`, and blocks completion.

```markdown
# Runtime E2E Test Plan: <name>

- Status: DRAFT
- Run ID: NOT_STARTED
- Environment: <runtime target>
- Tested revisions: NOT_STARTED
- Last updated: <UTC time the ledger was written, from `date -u +%Y-%m-%dT%H:%M:%SZ`>

## Scope

<observable behaviors and boundaries>

## Run summary

- Total: 1
- PASS: 0
- FAIL: 0
- BLOCKED: 0
- NOT_RUN: 1
- INVALIDATED: 0
- Release-blocking PASS: 0/1

## Existing suites

- `<suite id>`: NOT_RUN — <generated status after the run, with the new, unstable, removed, and pre-existing tests>

## Supporting checks

- `<command>`: NOT_RUN — <evidence after the run, or why it was not run>

## Human sign-off

- Decision: PENDING
- Reviewer: —
- Date: —
- Notes: Review release blockers, path fidelity, and subjective cases.

## Case D2 — Assign staff while editing a settled order

- Priority: RELEASE_BLOCKING
- Human judgment: NO

### Runtime path

Order List → Edit → select staff → Save adjustment; observe
`POST /orders/{id}/settled-corrections`; reload Order Detail.

### Expected

Save succeeds, the allocation persists after reload, totals and payments do not
change, and no unexpected runtime error is recorded.

### Execution

- Result: NOT_RUN
- Actual path: NOT_RUN
- Path match: NOT_RUN
- Observed: NOT_RUN
- Evidence: NOT_RUN
- Cleanup: NOT_RUN
- Can-fail: NOT_RUN

### Notes

<optional preparation, supporting checks, failure history, or plan revision>
```

## Allowed values

- Plan status: `DRAFT`, `READY`, `RUNNING`, `FAILED`, `BLOCKED`, `AWAITING_HUMAN`, `COMPLETED`.
- Priority: `RELEASE_BLOCKING`, `NORMAL`.
- Human judgment: `YES`, `NO`.
- Result: `NOT_RUN`, `PASS`, `FAIL`, `BLOCKED`, `INVALIDATED`.
- Path match: `NOT_RUN`, `YES`, `NO`.
- Human decision: `PENDING`, `ACCEPTED`, `REJECTED`.
- Cleanup: `NOT_RUN`, `NOT_REQUIRED`, `COMPLETE`, `INCOMPLETE`.
- Existing suite: `NOT_RUN`, `PASS`, `NEW_FAILURE`, `NEEDS_REVIEW`, `PRE_EXISTING`, `NOT_COMPARABLE`.

## Runtime proof rules

- A case passes only through its declared runtime path and observable expected result.
- For UI behavior, exercise the actual application in a browser or device.
- For this capability, browser and HTTP API execution uses native Playwright scripts rather than interactive agent clicks.
- Each expected outcome maps to an assertion and structured observation; screenshots alone cannot establish PASS.
- Persistence claims require fresh persisted-state proof, and invariant checks capture a baseline before mutation.
- Runtime API cases must call the running API and observe downstream state where relevant.
- Unit, widget, mocked, static, build, and source-inspection checks are supporting evidence only and cannot set a runtime case to `PASS`.
- An alternate endpoint or direct database mutation is not equivalent to the production path.
- A blocked production path remains `BLOCKED`; supporting checks do not upgrade it.
- After a fix, rerun the same failing runtime path.

## Evidence rules

A `PASS` case records:

- the actual runtime path;
- `Path match: YES`;
- the observed result;
- at least one auditable evidence reference;
- cleanup status when fixtures were created.

Evidence references should use repository-relative paths, request route/status, timestamps, correlation IDs, resource IDs, or artifact paths. Do not store secrets.

Store each run in a unique evidence directory containing approved snapshots, execution identity, native results, all attempts, structured observations, relevant traces, and cleanup outcomes.
Browser runs launch separate browsers, not shared CDP sessions.
Fixtures/accounts/shared databases need explicit isolation or serialized mutation with a project lock.
Retries, missing tests, and skips cannot silently count as clean PASS.
Follow the project's privacy policy before collecting traces; traces may contain sensitive requests or DOM content.

## Independent evidence audit

Agent B checks the approved snapshots against expected behavior, native results against observations, and generated reports against both.
Run the evidence tool's integrity/recomputation checks, then inspect assertion quality and runtime path fidelity in trace or request checkpoints.
Classify claims as `SUPPORTED`, `UNSUPPORTED`, `INCONSISTENT`, or `HUMAN_REVIEW_REQUIRED`.
Unsupported evidence is not itself a product failure; request targeted reruns rather than replaying every valid case.
Hashes detect inconsistencies against the approval snapshot but cannot authenticate execution against deliberate fabrication without trusted external provenance such as CI.

## Human review

The run summary is the review entrypoint. Human review should normally inspect:

1. Every release-blocking case.
2. Every `FAIL`, `BLOCKED`, or `INVALIDATED` case.
3. Cases marked `Human judgment: YES`.
4. Any `PASS` whose actual path or evidence appears unclear.

`AWAITING_HUMAN` means runtime execution is complete but subjective acceptance remains. Only an explicit human decision may set `Decision: ACCEPTED` and allow `Status: COMPLETED` when human judgment is required.

## Lifecycle

- `DRAFT`: cases are still being shaped.
- `READY`: runtime paths and expected outcomes are reviewable.
- `RUNNING`: evidence is being collected.
- `FAILED` or `BLOCKED`: unresolved runtime results remain.
- `AWAITING_HUMAN`: executable cases are complete and subjective review remains.
- `COMPLETED`: completion validation passes and required human sign-off is accepted.

Keep the summary and evidence ledger current so another session can audit the plan without relying on chat history.
