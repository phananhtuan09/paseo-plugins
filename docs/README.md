# Repository Knowledge

This tree stores durable repository knowledge for repository-driven work.
Read only the locations relevant to the requested outcome.

- `WORKFLOW.md` defines authority, work shapes, durable-memory thresholds, proof selection, and completion.
- `product/` stores accepted product and domain behavior.
- `decisions/` stores durable architecture, security, compatibility, operational, or product decisions.
- `plans/active/` stores resumable working memory for complex ongoing work.
- `plans/completed/` stores useful execution history for completed complex work.
- `patterns/` stores accepted recurring technical patterns and invariants.
- `runbooks/` stores verified operational procedures.
- `observed/` stores agent-maintained current-state facts inferred from code, history, or runtime behavior; it is context, not authority.
- `proposals/` stores optional proposal drafts and human approval records when the proposal capability is selected; proposals do not replace accepted product or decision authority.
- `other/` stores preserved historical workflow documents that are not part of the active protocol.
- `testing/` stores durable runtime end-to-end plans, execution evidence, cleanup state, and human sign-off when the runtime E2E capability is installed.
- `evaluation/` stores trace-first workflow evaluation standards, observations, session traces, and reports when the evaluation capability is installed.
- `learning/` stores the learning constitution, standard, namespace contract, project context, schedule, cases, and sessions when the learning capability is installed.
- `PRODUCT.md` stores a derived one-page product brief in the fixed schema read by the design capability when that capability is installed.
- `DESIGN.md` stores the accepted visual system record when the design capability is installed.

New repository knowledge uses the locations above.
`PRODUCT.md` and `DESIGN.md` keep these exact names at this exact level because an external capability resolves them by path.

Each durable artifact namespace governed by this protocol owns its admission criteria, filename convention, document structure, and writing rules in its local `README.md`.
Capabilities managing durable repository knowledge must discover eligible namespaces through this index and follow the target namespace's current `README.md` instead of embedding type-specific templates.
Resolve conflicts using the precedence and ambiguity rules in `WORKFLOW.md`.
