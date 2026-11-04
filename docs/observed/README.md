# Observed Knowledge

Store current-state facts that the agent inferred from code, tests, history, or runtime behavior here.
Verified operational procedures belong in `../runbooks/`, not here.
This location answers how the system behaves now, not how it should behave.
Observed knowledge is context for future work and never product, decision, or pattern authority.
An observed fact may describe a defect; do not use it to justify keeping or reproducing that behavior.

## Admission

Create or update an observed artifact only for a fact that future work needs and cannot cheaply rediscover from the code.
Every fact must cite repository evidence such as a path, stable symbol, commit, or test.
Do not record facts that an authority namespace already states; link to that artifact instead.
Update an existing topic before creating a competing document.
Use a lowercase kebab-case topic filename, such as `order-cancellation.md`.
`README.md` defines this namespace and is not an observed artifact.

## Document format

Use this structure:

```md
# <Observed topic>

Scope: <affected modules, systems, or domain boundary>

## Facts

- <One current-state fact per bullet.> Evidence: <path, symbol, commit, or test>

## Open questions

- <Behavior whose intent is unclear, such as a possible defect. Omit when none exist.>

## References

- <Related authority artifact. Omit when none exist.>
```

`Facts` and the `Scope` field are required.

## Lifecycle

When code changes a recorded fact, correct or remove the fact in the same task.
When a human explicitly states that a fact is intended behavior, move it to the matching authority namespace and remove it here.
Delete an artifact that has no remaining facts.

## Writing rules

Describe observable behavior and boundaries, not code walkthroughs.
State facts without normative terms such as MUST or SHOULD.
Do not guess rationale or intent; record the uncertainty under `Open questions`.
