# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The repository owner, a single developer who runs Claude Code, Codex, and OMP agents on a local Paseo daemon and follows them from the Paseo desktop app and from mobile.
The job is to supervise running agents: know what each one is doing right now, and skim what a finished turn did without opening every block.

## Product Purpose

A personal collection of local Paseo plugins that extend the Paseo app and daemon for the owner's own agent workflow.
Each top-level directory is one independently installable plugin.
Success means a plugin installs with `paseo plugin install`, reaches `running`, and makes agent supervision measurably easier than Paseo's default view.

## Positioning

Plugins are shaped around one person's real supervision habits across three different agent providers, normalized into one consistent view, rather than generic features for every Paseo user.

## Operating Context

- Plugins render inside the Paseo app (Expo / React Native, on desktop, web, iOS, and Android) and run beside the Paseo daemon on the owner's machine.
- The agent timeline is the main surface: user messages, assistant answers, reasoning, tool calls, errors, and notifications, streaming live while a turn runs.
- The owner switches between a wide desktop window and a narrow mobile screen.

## Capabilities and Constraints

- Plugin UI uses React Native primitives only (`View`, `Text`, `Pressable`, `ScrollView`, `TextInput`) plus components from `@getpaseo/plugin/client/ui`.
- All colors come from the active Paseo theme (`theme.colors`), so plugins follow light, dark, and plugin-contributed themes.
- Plugins are trusted, unsandboxed code; no remote services unless a plugin explicitly needs one.
- `requirements.paseo` must include Paseo 0.13.x; the owner currently runs 0.15.x.

## Brand Commitments

- Plugin visuals must feel like the owner's own style, clearly different from Paseo's default rendering and from the Beautiful Chat plugin, while still belonging inside the Paseo app.

## Product Principles

- Supervision first: the running state must be readable at a glance without tapping.
- Calm over loud: status must be unmistakable, but color and emphasis stay scarce so the agent's answer remains the focus.
- Same thing, same look: an activity looks identical regardless of which provider produced it.
- Reversible: disabling or removing a plugin returns Paseo to its default behavior.

## Accessibility & Inclusion

- Status must never rely on color alone; pair color with a glyph or text.
- Interactive rows expose their role and expanded state to assistive technology.
