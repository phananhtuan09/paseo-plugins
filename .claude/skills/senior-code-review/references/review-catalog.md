# Review catalog

Project-customizable: add, remove, or reword rows for this project. An edited copy is kept by `update --apply`.

This is a catalog, not a form.
For each review, pick the 2–3 dimensions that matter most for the reviewed code and state why.
A dimension that is not chosen is not reported on.

## Dimensions

| Dimension | Look for | Not a finding by itself |
| --- | --- | --- |
| Correctness and edge cases | Empty, error, loading, concurrent, and out-of-order inputs; race conditions; impossible states the code allows | A theoretical case no caller can reach |
| Architecture and boundaries | Module responsibilities, coupling, dependency direction, leaky abstractions | "Should be split" without a change cost |
| Type and contract modeling | Types that make impossible states unrepresentable (a discriminated union for `loading \| error \| success` instead of separate booleans); props that allow meaningless combinations; external data validated at the boundary instead of cast | Type style a linter enforces |
| State and data flow | Where state lives, single source of truth, derived vs. stored state, client/server sync | Choosing one valid state library over another (`preference`) |
| Error handling and failure modes | What the user sees, what is lost, what is retried, how a developer would debug it | Missing logging on a path that cannot fail |
| Security basics | Input handling, secrets in code, auth boundaries the code relies on | Anything that needs runtime probing; point to `security-performance-check` |
| Performance | A plausible real cost (N+1 requests, unbounded lists, work on every render or request) | Micro-optimizations; measured regressions belong to `security-performance-check` |
| Test quality | What the tests actually prove and what they miss; tests that pass while the behavior is broken | A missing test without a behavior it would protect |
| Maintainability and change cost | How hard the next likely change would be, with a concrete count of places to edit | Personal taste in file layout |
| Dependencies | An added library that is not justified (maintenance, bundle size), or an existing dependency reinvented | Version bumps or CVE audits |

## Frontend checklist

Use when the reviewed code renders UI.

| Area | Look for |
| --- | --- |
| Rendering | Unnecessary re-renders with a visible cost; state stored that could be derived |
| Effects | `useEffect` used for derived state or event handling; missing cleanup; stale closures |
| Data fetching | Races between requests, missing cancellation, a hand-rolled cache where the project's data-fetching library or a Server Component would do |
| Hydration | Server and client output that can differ (time, randomness, browser-only APIs) |
| Accessibility | Semantic elements, keyboard reachability, focus management on dialogs and route changes, labels |
| Responsive behavior | Layout that breaks at narrow widths or with long content |
| Bundle impact | Large dependencies or client code that could stay on the server |
