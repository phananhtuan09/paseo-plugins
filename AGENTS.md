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

Read `docs/WORKFLOW.md` for the full authority, work-shape, knowledge-layout, durable-memory, proof, and completion rules; the rules below always apply.

- Start from the requested outcome and inspect only the authority and implementation needed to deliver it; reuse existing repository patterns.
- Intent authority, in order: the current explicit human request for the delta it clearly authorizes, then accepted product, domain, architecture, security, and compatibility decisions in `docs/DECISIONS.md`.
- Code, tests, schemas, configuration, and runtime evidence are current-state evidence and plans are work memory; neither is intent authority, and knowledge inferred from them is never recorded as durable knowledge.
- When intended-behavior sources conflict and the request does not resolve it, or materially different externally observable choices remain open, stop before behavior-changing mutation and ask the smallest necessary question. Never invent material product, security, compatibility, or operational policy.
- Use the least complex work shape: answer read-only work with evidence; implement a bounded change directly with no plan or feature artifacts; create `docs/plans/active/<plan>.md` only when work must survive sessions, needs shared state or meaningful dependencies, or cannot be recovered from the repository alone.
- Specialized skills are optional; load one only when it materially improves correctness or proof. Never depend on a fixed execution chain or coordinator state.
- Preserve unrelated work; never overwrite, revert, or reformat changes outside the requested scope.
- Maintain durable knowledge yourself under `docs/`, keeping only what will outlive the task, and update durable intent made stale by an accepted request.
- Prove the change with the cheapest reliable check, reproducing a reported bug first when feasible. Do not claim completion until the requested behavior works end to end and its proof passed; report claims with evidence, limits, and what only a human can confirm, without fabricating evidence.
