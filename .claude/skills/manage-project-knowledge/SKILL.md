---
name: manage-project-knowledge
description: Find, explain, and maintain durable repository knowledge. Use when a human asks about accepted behavior, decisions, conventions, or other declared durable knowledge, when a human invokes it without a specific topic to maintain all project documentation, and on your own before reporting a task that changed durable truth or produced knowledge future work needs. Discover the target repository's documentation contracts instead of embedding current or future artifact formats in this skill.
---

# Manage Project Knowledge

## Outcome and scope

Find and explain durable repository knowledge without requiring the human to know its file location, and keep it current without requiring the human to request, approve, or edit documentation.
Use this skill when a human asks what the repository has recorded, why a durable choice exists, or how an accepted convention works.
When a human invokes this skill without a specific question or topic, or asks to sync, audit, or review the project's docs, run Maintain the whole project.
Also use it on your own before reporting a task in which the human accepted knowledge that should outlive the task, or the work invalidated recorded knowledge.
Explanation requests are read-only unless the conversation also accepted new knowledge.
Do not write artifacts merely because ordinary work occurred.

Change only artifact documents governed by the repository's documentation contracts.
Do not change production code, tests, dependencies, schemas, runtime configuration, workflow policy, documentation contracts (the header of `docs/DECISIONS.md` or a namespace `README.md`), or installer state.
Do not create scan reports, task trackers, plans, or placeholder artifacts to record that synchronization occurred.

## Discover the artifact system

Read the repository instructions and workflow authority before editing artifacts.
When present, read `docs/WORKFLOW.md` to distinguish durable repository authority from capability-owned or derived documentation; its repository knowledge layout is the index of durable locations.
Manage only locations that the current workflow classifies as durable repository knowledge, unless a future contract explicitly opts into this skill.
Do not assume that the locations or formats known when this skill was authored are complete.

For every candidate artifact:

1. Locate its declared location through the layout index.
2. Read that location's contract in full: the header of `docs/DECISIONS.md`, or a namespace's `README.md`.
3. Treat that contract as the authority for admission criteria, filenames, entry or document format, statuses, and editing rules.
4. Inspect existing entries or artifacts there for topic ownership, links, and local conventions the contract allows.
5. Update the entry or artifact that owns the topic before creating another.

If the repository has no layout index, the target location is not declared, or its contract does not define a usable format, report the contract gap and do not invent a format.
Future locations are supported through the same discovery process without changing this skill when they expose a complete contract.

## Establish authority

Separate accepted intent from current-state evidence and work memory.
A human's explicit statement of lasting behavior, a decision, or a convention in the conversation, or an answer to a decision question, establishes durable intent.
Choosing a next step, such as running tests or committing, establishes nothing, and a request scoped to one task is not a lasting rule unless the human says it should apply going forward.
Code, tests, schemas, configuration, history, and runtime observations describe current state; they do not by themselves establish intended product behavior, historical rationale, or an accepted recurring convention.
Never record such current-state facts as durable knowledge; future work rediscovers them from the repository.

Do not fabricate policy, rationale, approval, ownership, dates, verification, alternatives, or operational evidence.
Do not convert a suggestion, experiment, brainstorm, or unanswered question into an active artifact.
Before mutating knowledge, when intended-behavior sources conflict and the current request does not resolve the conflict, leave the disputed content unchanged and ask the smallest question needed.
When current-state evidence disagrees with accepted documentation, preserve the accepted intent and report the implementation drift instead of rewriting authority to match code.

## Find and explain knowledge

Treat questions such as “what is the rule,” “why was this chosen,” “how should this be implemented,” and “how do I operate or recover this system” as artifact discovery requests.
Do not require the human to identify a namespace, directory, filename, or document title.

For an explanation request:

1. Derive the topic and requested level of detail from the human's question.
2. Use the workflow authority and documentation index to select eligible namespaces.
3. Search artifact titles, metadata, headings, and content for the topic and its repository terminology.
4. Read the smallest complete set of relevant artifacts, including directly linked artifacts needed to preserve context, rationale, precedence, or safety.
5. Prefer active and accepted artifacts while identifying relevant superseded or deprecated material as historical context.
6. Answer the question directly, then cite every consequential rule, decision, invariant, or procedure with its repository-relative artifact path and section heading.

Explain in the language used by the human unless they request another language.
Preserve exact identifiers, status values, commands, paths, API names, normative terms, and domain vocabulary when translation or paraphrase would reduce precision.
For a documented procedure, preserve its order, prerequisites, warnings, stop conditions, verification, and recovery steps; do not shorten away safety-critical content.

Distinguish what the artifacts explicitly state from interpretation needed to connect them.
If relevant artifacts conflict, report the conflict, each artifact's status and authority, and the applicable workflow precedence rule; do not silently choose a convenient answer.
If no artifact records the requested knowledge, say that no durable answer was found.
Do not infer missing policy or rationale from code and do not create an authority artifact merely because the human asked a question.
Offer repository evidence separately only when it helps expose documentation drift, and label it as current-state evidence rather than durable intent.

An explanation response should contain:

- the direct answer;
- the governing artifact citations;
- relevant constraints, exceptions, status, or safety conditions;
- conflicts, missing knowledge, or current-state drift when present.

## Select the mutation

Work from the topics the human's request or the completed task touched, or from every topic during Maintain the whole project.
Search the declared namespaces for an artifact that already owns each topic.
Prefer the smallest coherent update that leaves one clear home for each rule, decision, convention, or procedure.
Link related artifacts instead of duplicating their content.

Create an artifact only when:

- the knowledge satisfies the target namespace's admission criteria;
- a human accepted the knowledge in the conversation;
- no existing artifact owns the topic; and
- every required field and section can be supported without speculation.

Update an artifact when accepted knowledge changes, clarification removes material ambiguity, supported references improve traceability, or the namespace contract requires lifecycle metadata to change.
Preserve still-valid content and history.
Apply lifecycle changes exactly as the contract specifies; in `docs/DECISIONS.md`, edit a changed entry in place and delete one that no longer applies.

Apply supported documentation edits directly; no separate approval is needed.
If the human asks for a preview, dry run, or proposal, show the proposed changes without writing them.

## Maintain after a task

Before reporting a task, check whether it:

1. accepted new product behavior, a decision, or a convention; record it and cite the accepting request as its contract specifies;
2. changed code that recorded knowledge describes; update the knowledge only when the human requested that change;
3. changed code against authority without a human request; leave the authority unchanged and report the drift;
4. left artifacts it touched or made stale replaced, duplicated, or outdated; edit or delete outdated entries, merge duplicates, fix links, or move or delete finished plans as their contracts require.
   Leave unrelated artifacts to Maintain the whole project.

When none applies, make no edits.

## Maintain the whole project

Bring all durable knowledge in line with the conversation and the current repository:

1. Record knowledge the human accepted in the current conversation, as in Maintain after a task.
2. Check every rule, decision, and convention in the authority locations against code, tests, schemas, and configuration.
   Report each disagreement as drift with its evidence; never rewrite authority to match code.
   Report authority artifacts that lack a citation their contract requires as a contract gap; never add a citation you cannot source from the conversation.
3. Merge accepted records from an older `docs/decisions/`, `docs/product/`, or `docs/patterns/` into `docs/DECISIONS.md` and delete the merged files, as `docs/WORKFLOW.md` describes.
4. Tidy: edit or delete outdated entries, merge duplicates, fix broken links, and move or delete finished active plans.

On a large repository, check the most central and most changed areas first, and report which areas remain unchecked.
Repeat runs on an unchanged repository should converge: a further run makes no edits.

## Write through the contract

Use the target's current contract as the template and writing standard.
Include every required field and section.
Omit optional sections when they add no supported information.
Follow its filename, status, linking, evidence, and lifecycle conventions exactly.
Preserve stricter conventions already established by valid artifacts when they do not conflict with the contract.

Write concise durable claims rather than task narration.
Keep unrelated knowledge unchanged.
Use repository-relative links and stable symbols where the contract permits references.
Never copy secrets, credentials, private tokens, generated output, or large source excerpts into an artifact.
Do not weaken a required section, invent placeholder content, or mark unsupported information as verified merely to complete a template.

## Handle incomplete information

Ask the human only when intended-behavior sources conflict and the conversation does not resolve the conflict.
Before asking, inspect the relevant authority, existing artifacts, and available evidence.
Group independent unresolved questions into one focused round.
For each question, identify the conflicting or missing fact and the artifact field or claim it blocks.
Do not ask for information already available in the repository.

Continue independent supported edits while disputed topics remain deferred.
If required information remains unavailable, leave the affected artifact unchanged or uncreated and report exactly what is missing.

## Verify

After editing:

1. Re-read each changed entry or artifact against its contract.
2. Confirm all required metadata and sections are present and supported.
3. Check filenames, statuses, and relative links.
4. Check that no topic was duplicated across entries, artifacts, or locations.
5. Check consequential claims against their cited authority or evidence.
6. For operational procedures, accept only trustworthy prior execution evidence or a safe verification performed after reviewing prerequisites and effects.

Do not execute deployments, destructive migrations, production operations, or commands against unknown services or data merely to complete documentation.
If a procedure cannot be safely verified, do not claim that it is verified.
An unchanged repository with no newly accepted knowledge should produce no edits on a repeat run.

## Handoff

Report:

- artifacts created or updated and why;
- the contract used for each artifact;
- evidence or authority checked;
- verification actually performed;
- deferred topics, contract gaps, implementation drift, or unresolved conflicts.

If no artifact update is justified, say so and give the durable-knowledge reason without creating a file to record the run.
