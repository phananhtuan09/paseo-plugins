# Plugin directory layout

Status: Active
Applies to: Every top-level plugin directory in this repository

## Problem

The repository is a collection of independent Paseo plugins, and an agent must be able to find, typecheck, and install any one of them on the Paseo daemon without extra context.

## Applicability

Use this layout for every plugin added to or copied into the repository.
It does not apply to the workflow tooling paths `AGENTS.md`, `docs/`, `.claude/`, and `.ai-workflow/`.

## Pattern

- One top-level directory per plugin, named after the `id` in its `paseo-plugin.json`.
- Each plugin is self-contained: its own `package.json`, `package-lock.json`, `tsconfig.json`, and `node_modules`, with an `npm run typecheck` script.
  There is no shared workspace root.
- Code lives only in the entries `index.client.tsx` and/or `index.server.ts` and in the `client/`, `server/`, and `shared/` folders the plugin uses, following the Paseo runtime boundaries.
- Each plugin has a `README.md` that tells an agent how to install it on the Paseo daemon: prerequisites including `requirements.paseo` and the `pluginsEnabled` check, install, update, verify, troubleshoot, and remove.
- `OVERVIEW.md` is added only when the plugin is listed in the Paseo registry.

## Invariants

- The directory name equals the plugin `id`.
- Every plugin has a `README.md` with daemon install instructions, kept in sync with its behavior and `requirements.paseo`.
- `npm run typecheck` passes inside the plugin directory before install or reload.

## Example

- [`usage-pill/`](../../usage-pill) with [`usage-pill/README.md`](../../usage-pill/README.md).

## Trade-offs

- Dependencies are duplicated per plugin, in exchange for plugins that install and update independently.

## References

- Human request, 2026-11-04: the project is a collection of Paseo plugins, each folder is its own plugin and has a README guiding an agent to install it on the Paseo daemon.
- [`AGENTS.md`](../../AGENTS.md) sections `Project` and `Paseo daemon safety`.
