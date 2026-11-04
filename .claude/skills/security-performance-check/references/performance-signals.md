# Performance signals

This file is project-customizable: add, remove, or reword rows, change a threshold, or tune hints.
An edited copy is kept by `update --apply`.
`scripts/check_findings.py signals --track performance` reads the table below; editing a row changes `signals_loaded[]` on the next run without touching `SKILL.md`.

Every row whose `level` is not `off` loads on every performance run, in any language or framework.
Hints only point the agent at the changed files to read first; they never decide whether a row loads.

## Project type decides what is measured

Record `summary.performance_scope = {project_type, collectors}`; the checker enforces the pairing.

| project_type | collectors allowed | what to measure |
| --- | --- | --- |
| `web-ui` | `playwright`, `http`, `build`, `lighthouse` | Browser flows through `runtime-e2e-test` (Playwright), plus build output for bundle size. |
| `api-only` | `http` | Request count and response time with an HTTP client that records a HAR (real per-request `startedDateTime`, `log.creator.name` set to the tool). No browser metrics. |
| `cli`, `mobile`, `library` | none | Nothing is measured. Write the limit under `limits` / `Giới hạn`; never report a number that was not collected. |

A finding is accepted only when its row's `source` list shares a collector with `performance_scope.collectors`.
For `web-ui`, every noisy row measured only in the browser (`source` within `playwright`, `lighthouse`: LCP, CLS, INP/TBT, long tasks) runs by default with `min_runs_per_side` (5) interleaved base/head samples, recorded in `summary.browser_metrics.<id>`.
Skipping one needs `browser_metrics.<id>.skipped = {kind, reason}` with a concrete cause: `time_budget` (with `budgets.time_minutes` used >= limit), `collector_unavailable`, `flow_broken`, or `not_rendered`. `run` rejects a web-ui run with neither (see `evidence-contract.md`).
Use Lighthouse only when the project already has it; otherwise record that limit under `Giới hạn`.

Columns:

- `metric_class`: `exact` (one run per side, exact diff) or `noisy` (at least `min_runs_per_side` interleaved runs; default floor is 5).
- `source`: comma-separated collectors that can measure the row: `playwright` (browser via runtime-e2e-test), `http` (HTTP client that writes a HAR), `build` (build output), `lighthouse` (only when the project already has it).
- `direction`: `lower_better` or `higher_better`.
- `aggregation`: value compared after the runs (`median`, `count`, `max`, `min`, `sum`).
- `threshold`: small parseable grammar, e.g. `median < base*1.10` or `count <= base`, with an optional absolute budget after `;` (e.g. `median < base*1.10; abs < 2500`).
  When the base aggregate is `0`, a relative clause (`base` or `base*factor`) treats strict `<` / `>` as `<=` / `>=` so identical zeros pass; a nonzero head still fails a lower_better relative threshold. Absolute budget clauses are unchanged.
- `min_runs_per_side`: minimum samples per side before judging; noisy rows need at least 5.
- `route_pattern`: path hints (directory or file-name globs, no extension lists); `*` does not cross `/`, `**` does.
- `content hints`: backticked literal tokens matched against changed lines of `signals --diff` (examples from many stacks).
- `level`: `off` (skip), `warn` (report under Giới hạn when it fails), or `error` (exploited finding when it fails).
- `fix_hint`: short remediation note for the report.

Tests, fixtures, e2e directories, and i18n catalogs never count as hints (see `DEFAULT_PATH_EXCLUDES` in `check_findings.py`).

## Signals

| id | metric_class | source | direction | aggregation | threshold | min_runs_per_side | route_pattern | content hints | level | fix_hint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `request-count` | exact | playwright, http | lower_better | count | `count <= base` | 1 | `**/pages/**`, `**/app/**`, `**/routes/**`, `**/api/**`, `**/components/**`, `**/views/**`, `**/templates/**`, `**/controllers/**` | `fetch(`, `axios`, `useQuery`, `useSWR`, `$http`, `HttpClient`, `requests.get`, `httpx`, `RestTemplate`, `WebClient`, `http.Get(`, `Http::`, `Net::HTTP`, `.map(`, `forEach`, `for ` | error | Collapse per-row fetches into one list or batch endpoint; drop duplicate requests for the same URL; avoid N+1 queries behind one endpoint. |
| `payload-bytes` | exact | playwright, http | lower_better | median | `median < base*1.10` | 1 | `**/pages/**`, `**/app/**`, `**/api/**`, `**/serializers/**`, `**/dto/**`, `**/controllers/**`, `**/resources/**` | `res.json(`, `JsonResponse`, `jsonify(`, `render json:`, `response()->json`, `ResponseEntity`, `c.JSON(`, `fields = '__all__'`, `include:`, `select(`, `SELECT *` | warn | Trim unused fields, paginate, or compress large JSON responses on the changed flow. |
| `bundle-size` | exact | build | lower_better | median | `median < base*1.15; abs < 512000` | 1 | `**/webpack*`, `**/vite*`, `**/next.config.*`, `**/nuxt.config.*`, `**/package.json`, `**/src/**`, `**/frontend/**`, `**/client/**`, `**/assets/**` | `import `, `require(`, `dynamic(`, `lazy(` | warn | Code-split the changed entry, drop unused imports, or move heavy deps off the critical path. |
| `background-requests` | exact | playwright | lower_better | count | `count <= base` | 1 | `**/pages/**`, `**/app/**`, `**/components/**`, `**/hooks/**`, `**/views/**`, `**/templates/**`, `**/static/**` | `setInterval`, `setTimeout`, `refetchInterval`, `pollInterval`, `WebSocket`, `EventSource`, `addEventListener`, `subscribe(`, `$interval`, `turbo_stream`, `wire:poll`, `hx-trigger` | error | Clear timers, intervals, and subscriptions on unmount; cancel in-flight polls when leaving the page. |
| `response-time` | noisy | playwright, http | lower_better | median | `median < base*1.10` | 5 | `**/api/**`, `**/routes/**`, `**/controllers/**`, `**/handlers/**`, `**/server/**`, `**/backend/**`, `**/*route*`, `**/services/**`, `**/repositories/**`, `**/models/**` | `SELECT`, `.objects.`, `.filter(`, `.where(`, `findAll`, `findMany`, `include(`, `prefetch_related`, `select_related`, `includes(`, `with(`, `JOIN`, `await `, `sleep(`, `for ` | warn | Profile the changed handler; cut serial work and avoid repeated I/O or N+1 queries inside the hot path. |
| `lcp` | noisy | playwright, lighthouse | lower_better | median | `median < base*1.10; abs < 2500` | 5 | `**/pages/**`, `**/app/**`, `**/layouts/**`, `**/views/**`, `**/templates/**` | `<img`, `Image`, `font`, `<link`, `<script` | warn | Prioritize the LCP element (image/text), reduce render-blocking work, and keep the above-the-fold payload small. |
| `cls` | noisy | playwright, lighthouse | lower_better | median | `median < base*1.10; abs < 0.1` | 5 | `**/pages/**`, `**/app/**`, `**/components/**`, `**/views/**`, `**/templates/**`, `**/styles/**` | `<img`, `height`, `width`, `position`, `margin`, `insertBefore` | warn | Reserve space for late images and ads; avoid inserting content above existing layout after paint. |
| `inp-tbt` | noisy | playwright, lighthouse | lower_better | median | `median < base*1.10; abs < 200` | 5 | `**/pages/**`, `**/app/**`, `**/components/**`, `**/views/**`, `**/static/**` | `onClick`, `@click`, `on:click`, `addEventListener`, `onChange`, `onInput` | warn | Break long event handlers, defer non-critical JS, and keep interaction work under the budget. |
| `long-tasks` | noisy | playwright | lower_better | count | `count <= base; abs <= 5` | 5 | `**/pages/**`, `**/app/**`, `**/components/**`, `**/static/**` | `JSON.parse`, `.sort(`, `.map(`, `for ` | warn | Split tasks over 50ms; move heavy work off the main thread or behind idle callbacks. |

### Request-count evidence

For `request-count` and `background-requests`, both sides are measured once (`n = 1`) and both HARs are kept: `evidence.har_path` (head) and `evidence.base_har_path` (base).
`evidence.request_filter` says what was counted: `{url_contains, methods, exclude_assets, after: {base, head}, window_ms}` (all optional except as noted below).
`check_findings.py run` recounts each HAR with that filter and rejects the finding unless the count equals `metric.base` / `metric.head` exactly.
Both HARs must come from the collector: `log.creator.name` set, every entry with a real `startedDateTime`, and not all entries sharing one start time (`check_findings.py har --recorded`).

### `background-requests` measurement

Use this exact procedure on base and on head (same auth, viewport, and throttle as `conditions{}`):

1. Open each changed page URL; wait until the document load (and network idle if the harness supports it).
2. Navigate to a different same-origin page (for example `/` or a documented neutral route in project-runtime).
3. Record the time that navigation's document request started; it is `request_filter.after.<side>`.
4. Keep recording for the next **15 seconds** (`window_ms >= 15000`). The count is the requests that start after `after` and within the window, with `exclude_assets: true` (scripts, styles, images, fonts). Repeating poll/timer-driven API calls and WebSocket upgrades count; the navigation document itself does not.
5. Keep the page-load requests from step 1 in the HAR; the checker rejects a HAR with no request before `after`.
6. Compare with `count <= base` via `check_findings.py threshold`. Head strictly greater than base fails.
