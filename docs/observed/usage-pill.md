# usage-pill

Scope: `usage-pill/` plugin and its install on the local Paseo daemon

## Facts

- The source was copied from `paseo-plugins/usage-pill` in `github.com/phananhtuan09/ai-agent-workflow` (branch `main`) on 2026-11-04. Evidence: `usage-pill/paseo-plugin.json`
- The plugin requires Paseo `>=0.10.2` and typechecks against `@getpaseo/plugin` 0.10.3. Evidence: `usage-pill/paseo-plugin.json`, `usage-pill/package.json`
- Each agent with a workspace gets two composer pills, `usage` and `context`, which stay hidden until data is available. Evidence: `register` in `usage-pill/index.client.tsx`
- Provider usage comes from `paseo.providers.listUsage()`, refreshed every 60 seconds and when the usage pill is pressed. Evidence: `refresh` and `REFRESH_MS` in `usage-pill/index.client.tsx`
- For `omp` agents, usage comes from the server RPC `omp.usage`, which runs `omp usage --json --provider <provider>` on the daemon with a 20 second timeout. Evidence: `readOmpUsage` in `usage-pill/server/omp-usage.ts`
- The pill icon turns warning at 70% and danger at 90%, based on the rounded percentage. Evidence: `levelOf` in `usage-pill/index.client.tsx`
- The context pill shows `contextWindowUsedTokens / contextWindowMaxTokens` from the agent's `lastUsage`. Evidence: `describeContext` in `usage-pill/index.client.tsx`
- On 2026-11-04 the running `usage-pill` on the local daemon (Paseo 0.15.0) was installed from `/Users/mac/Desktop/source-codes/ai-agent-workflow/paseo-plugins/usage-pill`, not from this repository. Evidence: `paseo plugin ls`

## Open questions

- Whether the daemon install should be switched to this repository's copy.
