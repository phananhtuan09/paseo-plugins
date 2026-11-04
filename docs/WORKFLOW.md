# Repository-driven Workflow

## Purpose

The repository-driven protocol is the default operating model.
It starts from the requested outcome and repository authority instead of requiring a fixed artifact or execution chain.
There is no fixed design, specification, execution, verification, or orchestration chain.

## Authority

Use the smallest relevant authoritative surface.
Separate intent authority, current-state evidence, and work memory.

Intent authority describes what behavior is intended:

1. The current explicit human request is immediate intent authority for the requested delta when it clearly authorizes a behavior change.
2. Approved product and domain rules describe durable intended externally observable behavior.
3. Approved architecture, security, and compatibility decisions constrain implementation choices.

Current-state evidence describes what exists now:

- Code
- Tests
- Schemas
- Configuration
- Runtime evidence

Work memory preserves execution state:

- Active plans describe resumable work state but never override intent authority.
- Completed plans preserve useful execution history but never become product authority by themselves.

Evaluation, learning, and design standards govern only their explicitly selected optional capabilities.

Apply these conflict rules:

- If the current explicit request clearly changes existing behavior, treat the request as authority for that requested delta.
- If durable product or decision docs become stale because of an accepted change, update them as part of the task when the new behavior should outlive the current task.
- If code, tests, schemas, configuration, or runtime evidence disagree, investigate the current-state inconsistency.
- If multiple intended-behavior sources conflict and the current request does not resolve the conflict, stop before behavior-changing mutation and ask the smallest necessary human question.
- If `docs/PRODUCT.md` or `docs/DESIGN.md` disagrees with `docs/product/` or `docs/decisions/`, treat the durable location as authority and correct the derived file.
- If code changes that no human request authorized disagree with durable intent, report the drift and keep the intent unchanged.

Newly accepted durable knowledge belongs in the following locations:

| Knowledge | Location |
| --- | --- |
| Product and domain rules | `docs/product/` |
| Architecture and compatibility decisions | `docs/decisions/` |
| Active durable plans | `docs/plans/active/` |
| Completed durable plans | `docs/plans/completed/` |
| Recurring technical patterns | `docs/patterns/` |
| Verified operating procedures | `docs/runbooks/` |
| Observed current-state knowledge | `docs/observed/` |

Proposal, evaluation, learning, and design artifacts are optional capability-owned namespaces:

- `docs/proposals/` contains optional proposal working material and human approval records when the proposal capability is selected; it does not replace accepted product or decision authority.
- `docs/evaluation/` contains workflow evaluation standards, observations, traces, and reports.
- `docs/learning/` contains learning standards and durable learning state.
- `docs/PRODUCT.md` and `docs/DESIGN.md` contain the design capability's product brief and visual system record.

The evaluation and learning namespaces are independent of repository product authority and must not be silently merged into it.

Ordinary coding work must not read `docs/learning/cases/` or `docs/learning/sessions/`. They hold hidden learning facts, events, and assessment records, and only the learning capability reads them.

The design namespace is subordinate rather than independent:

- `docs/PRODUCT.md` is a derived summary written in an external capability's fixed schema and is never durable product authority.
- `docs/DESIGN.md` is authority for the accepted visual system and remains constrained by `docs/decisions/`.
- Both files keep these exact names directly under `docs/` because an external capability resolves them by path, so they must not be renamed, nested, or moved.
- Do not create a repository-root `PRODUCT.md` or `DESIGN.md`, or the same names under `.agents/context/`.
  Either location silently takes precedence over `docs/` and strands the reviewed files.

## Work shapes

### Read-only work

Use this shape for explanation, investigation, review, diagnosis, or human-requested planning.
Inspect the smallest relevant surface and answer with evidence.
Do not create durable workflow artifacts by default.

### Bounded change

Use this shape for a localized feature, bug fix, validation change, UI change, or isolated refactor with a clear outcome.
Inspect the affected authority and current behavior, implement the smallest coherent change, run behavior-appropriate proof, and report the result.
Do not create a durable plan, feature artifact, or coordinator state for bounded work.

### Durable change

Create or resume `docs/plans/active/<plan>.md` only when at least one durable-memory condition applies:

- The work is likely to span sessions.
- Multiple contributors or agents need shared resumable state.
- Meaningful dependencies require coordinated sequencing.
- Recovery or rollback context must survive the current session.
- The task cannot be resumed safely from the repository and diff alone.

Keep only goals, current state, material decisions, dependencies, and validation evidence needed for safe resumption.
After the work and proof are complete, move a still-useful plan to `docs/plans/completed/`.
A plan is working memory and never product authority.

### Decision-blocked work

A task is decision-blocked when materially different product, security, compatibility, or operational choices remain open.
Stop before externally observable mutation and ask the smallest question that resolves the missing authority.
Choose ordinary implementation details directly when they do not create material policy.

## Execution rules

Inspect only files relevant to the requested outcome and affected behavior.
Reuse established repository patterns instead of creating parallel conventions.
Prefer the simplest mechanism that preserves correctness, safety, recoverability, and durable repository understanding.
Do not add a command, skill, workflow step, or artifact type without demonstrated recurring use.
Implement the smallest coherent end-to-end change rather than suppressing a symptom.
Preserve unrelated local changes.
Treat specialized skills as optional capabilities and load one only when it materially improves the work.
Do not make normal repository-driven execution depend on feature artifacts or coordinator state.
Do not add a fixed execution chain or require workflow artifacts for ordinary work.
Do not fabricate product rules, decisions, plans, runbooks, proof, or execution state.
When counting, filtering, aggregating, or extracting from bulk data of roughly five or more files or 300 or more lines, write a small script that prints only the needed result instead of reading the raw data into context.
Bulk data means logs, test or build output, payloads, and statistics across many files; reading code to understand or change it is not bulk data, and a search script never replaces reading a component you are about to change.
Keep such scripts in a temporary or git-ignored directory so they can be rerun to show how a result was produced without polluting the repository.
These thresholds are approximate guidance, not hard limits.

## Durable knowledge maintenance

The agent maintains durable knowledge; the human does not need to request, approve, or edit documentation.
The human sees knowledge changes in the task report and the diff, and a revert or later request corrects them.

Write to `docs/product/` only for accepted behavior that should outlive one implementation task.
Write to `docs/decisions/` only for meaningful decisions and rationale future work must respect.
Write to `docs/patterns/` only for accepted recurring technical guidance.
Write to `docs/runbooks/` only for verified operational procedures.
Write to `docs/observed/` only for current-state facts that future work needs and cannot cheaply rediscover from the code.
Do not create durable files merely to record that ordinary work occurred.

Knowledge is accepted when a human explicitly states lasting behavior, a decision, or a convention in the conversation, or answers a decision question.
Choosing a next step, such as running tests or committing, accepts no knowledge.
A request scoped to one task is not a lasting rule unless the human says it should apply going forward.
Record accepted knowledge in its namespace before reporting the task, and cite the accepting request in the artifact.
Knowledge inferred from code, tests, history, or runtime behavior is observed, not accepted.
Record it only in `docs/observed/`, never treat it as intent authority, and correct or remove it when the code it describes changes.
A verified operational procedure is the exception: record it in `docs/runbooks/` under that namespace's contract.
When a human explicitly states that an observed fact is intended behavior, move it to the matching authority namespace and remove the observed entry.
After a task, keep current the knowledge that task touched or made stale: mark replaced artifacts superseded, merge duplicates, fix broken links, and move finished plans to `docs/plans/completed/`.
Tidy the rest of the tree only during a whole-project maintenance pass.
Ask the human only when intended-behavior sources conflict and the current request does not resolve the conflict.

Each durable artifact namespace governed by this protocol defines its current admission criteria and document contract in that namespace's `README.md`.
Capabilities managing durable repository knowledge must discover eligible namespaces through `docs/README.md` and follow the selected namespace contract rather than carrying a second embedded format.
When adding a durable artifact namespace, classify and index it in `docs/README.md` and provide its local contract before creating artifacts in it.

## Proof selection

Choose the cheapest reliable proof that observes the changed behavior.
Use focused unit proof for pure local logic, integration proof for boundaries, runtime or browser proof for visible behavior, and measurement for performance claims.
For a regression bug, reproduce the failure before the fix and confirm the same scenario after the fix when feasible.
For a bug whose cause is not evident, first build a fast check that fails on the bug, then state for each hypothesis the result it predicts on that check before changing code.
When no cheap reproduction is feasible, state why and gather the closest observational evidence, such as logs, traces, bisection, or a runtime observation, instead of trying guessed fixes.
Keep the reproduction as a regression test when it fits the project's test suite; otherwise remove it with the other temporary proof scaffolding.
For migration or recovery-sensitive behavior, exercise a dry run or recovery scenario.
Repository-wide checks supplement focused proof but do not replace it.
For multi-case runtime E2E work that must survive sessions or support later audit, use the installed runtime E2E capability and its namespace contract. A runtime case passes only through its declared production path and observable result; unit, widget, mocked, build, and source checks remain supporting proof.

## Completion

Complete every requested end-to-end behavior and named acceptance criterion.
Record durable knowledge changes as described in Durable knowledge maintenance and list them in the report.
Remove temporary proof fixtures and scaffolding before completion.
Report every handoff, bounded or durable, in three parts, scaling detail with risk; for a small change one line per part is enough.
Claims: state each changed behavior with the evidence observed for it, such as the command run and its result, a file and line, or observed output.
Limits: state what that evidence did not exercise or check.
Human confirmation: list separately what only a human can confirm, such as product fit, UX, or business correctness, and never present it as verified.
Do not claim evidence that was not observed.
