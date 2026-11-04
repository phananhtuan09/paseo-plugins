# Repository-driven Agent Protocol

## Project

- This repository is a collection of local [Paseo](https://paseo.sh) plugins.
- Each top-level plugin directory is one independent plugin, and its name matches the `id` in its `paseo-plugin.json`.
- Non-plugin top-level paths are `AGENTS.md`, `docs/`, `.claude/`, and `.ai-workflow/`.
- Each plugin directory contains `paseo-plugin.json`, `package.json`, `tsconfig.json`, `README.md`, at least one entry (`index.client.tsx` and/or `index.server.ts`), and only the `client/`, `server/`, and `shared/` code folders it uses.
- Each plugin's `README.md` tells an agent how to install it on the Paseo daemon: prerequisites, the `pluginsEnabled` check, install, update, verify, troubleshoot, and remove steps.
  Keep it in sync with the plugin's behavior and `requirements.paseo` whenever the plugin changes.
- `OVERVIEW.md` is optional and only needed when the plugin is listed in the Paseo registry.
- Plugins have no shared package or workspace root; run `npm install` and `npm run typecheck` inside the plugin directory.
- Use the `paseo-plugin` skill when creating or changing a plugin, and create new plugins with `paseo plugin init "$PWD/<plugin-id>"`.

## Paseo daemon safety

- Plugins are trusted, unsandboxed code; never enable the daemon's `pluginsEnabled` switch or install a plugin without explicit human approval.
- Load source changes with `paseo plugin reload <id>`, never by restarting the daemon, because a restart kills running agents.
- Before installing, check `paseo plugin ls`; if the same ID is installed from another directory, ask before removing or replacing it.

## Operating model

- Start from the requested outcome, then inspect the repository authority and implementation needed to deliver it.
- Read `docs/WORKFLOW.md` for the detailed authority, work-shape, durable-memory, and proof rules.
- Use the least complex work shape that remains correct, safe, maintainable, and recoverable.
- Treat specialized skills as optional capabilities. Load one only when it materially improves the work; they never form a required execution chain.

## Authority

- Intent authority defines intended behavior.
- The current explicit human request is immediate intent authority for the requested delta when it clearly authorizes a behavior change.
- Approved product and domain rules define durable intended externally observable behavior.
- Approved architecture, security, and compatibility decisions constrain implementation choices.
- Code, tests, schemas, configuration, and runtime evidence are current-state evidence.
- Current-state evidence describes what exists now and disagreements between those sources normally require investigation before deciding what to change.
- Active plans record work state but do not override product or architecture authority.
- Evaluation and learning capabilities use their canonical namespaces under `docs/evaluation/` and `docs/learning/`.
- When durable intent becomes stale because of an accepted current request, update it as part of the task when the new behavior should outlive the current task.
- Knowledge inferred from code, history, or runtime behavior is observed knowledge under `docs/observed/` and never intent authority.
- When multiple intended-behavior sources conflict and the current request does not resolve the conflict, stop before behavior-changing mutation and request the smallest necessary decision.
- Never invent material product, security, compatibility, or operational policy.

## Work shaping

- For read-only work, inspect the smallest relevant surface and answer with evidence without creating a workflow artifact.
- For a bounded change, inspect affected authority and behavior, implement the smallest coherent change, prove it, and report it directly without creating feature artifacts, a durable plan, or coordinator state.
- Create or resume `docs/plans/active/<plan>.md` only when work must survive sessions, contributors need shared state, dependencies are meaningful, or recovery context cannot be reconstructed safely from the repository.
- Ask for human direction only when materially different externally observable choices remain unresolved.

## Execution

- Inspect only relevant files and reuse existing repository patterns before introducing new structure.
- Preserve unrelated work and never overwrite, revert, or reformat changes outside the requested scope.
- Maintain durable repository knowledge yourself, without waiting for a human request, following `docs/WORKFLOW.md`; keep only knowledge that will outlive the current task.
- Load a specialized skill only when it materially improves correctness or proof.
- Use direct repository-driven execution; do not create or depend on a legacy coordinator state.

## Proof and completion

- Select the cheapest reliable proof for the changed behavior, such as a focused test, integration check, runtime observation, browser check, or measurement.
- Reproduce a reported bug before changing code when the repository and environment make reproduction feasible.
- Do not claim completion until the requested behavior is implemented end to end and relevant proof has passed.
- Report changed behavior with the checks actually run, what that evidence did not cover, unresolved failures, remaining material risk, and what only a human can confirm, without fabricating evidence.
