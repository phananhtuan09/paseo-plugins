# Surface rules

This file is project-customizable: add, remove, or reword rules, change a level, or tune a setting. An edited copy is kept by `update --apply`.
`scripts/surface-scan.cjs` reads the settings and the rules table below; editing them changes the next scan without touching `SKILL.md`.

Every rule applies to added diff lines only and never to pre-existing code.
A `regex` check is a JavaScript regular expression matched against each added line; start it with `(?i)` to ignore case, and write a literal `|` as `\|` inside the table.
A `builtin:` check runs a scan that a single regex cannot express. A `judgment` check is not scanned: the agent applies it while reading the diff and reports it only with the evidence the rule names.
`files` is a comma-separated list of file extensions, or `*` for every file. The scanned rules list code and style extensions only, so documentation is not scanned.

## Settings

- cap: 10
- ignore: package-lock.json, yarn.lock, pnpm-lock.yaml, *.min.js, *.map, dist/**, build/**, coverage/**, node_modules/**, *.snap
- tests: *.test.*, *.spec.*, test/**, tests/**, e2e/**, __tests__/**
- max-function-lines: 80
- max-file-lines: 400
- comment-ratio: 0.6
- min-comment-lines: 5
- magic-number-allow: 10, 100, 1000

## Rules

| ID | Category | Level | Files | Check | What |
| --- | --- | --- | --- | --- | --- |
| `commented-out-code` | comments | Nên sửa | js,jsx,ts,tsx,mjs,cjs,vue | `^\s*//\s*(const\|let\|var\|function\|return\|if\s*\(\|for\s*\(\|import\s\|export\s\|await\s\|[\w.]+\(.*\);\s*$)` | Code left behind in a comment instead of being deleted. |
| `commented-out-code-py` | comments | Nên sửa | py | `^\s*#\s*(def\s\|class\s\|return\b\|import\s\|from\s\S+\simport\|if\s.*:\s*$\|for\s.*:\s*$\|print\()` | Code left behind in a comment instead of being deleted. |
| `changelog-comment` | comments | Nên sửa | js,jsx,ts,tsx,mjs,cjs,vue,py,go,rb,java,kt,swift,rs,php,cs,sh,css,scss,less | `(?i)(^\|\s)(//\|#\|/\*\|\*)\s.*(\b(changed\|updated\|modified\|refactored\|replaced\|moved\|renamed) (from\|to)\b\|\bno longer\b\|\bwas changed\b\|\bnow uses\b\|\binstead of the old\b\|\b(old\|new) (version\|implementation\|code)\b)` | A comment that narrates the edit history; history belongs in the commit message. |
| `comment-ratio` | comments | Tuỳ chọn | js,jsx,ts,tsx,mjs,cjs,vue,py | `builtin:comment-ratio` | The added lines of a file are mostly comments (above `comment-ratio`, at least `min-comment-lines`). |
| `comment-restates-code` | comments | Tuỳ chọn | * | `judgment` | A comment that says what the next line plainly does. Quote the comment and the line. |
| `debug-statement` | cleanliness | Nên sửa | js,jsx,ts,tsx,mjs,cjs,vue | `\bconsole\.(debug\|trace\|dir)\(\|\bdebugger\b` | Debug output or a breakpoint left in source. |
| `debug-log` | cleanliness | Nên sửa | jsx,tsx,vue | `\bconsole\.log\(` | A `console.log` left in UI code. Command-line and server code may print on purpose, so this rule covers UI files only. |
| `type-escape` | cleanliness | Nên sửa | ts,tsx | `\bas any\b\|:\s*any\b\|<any>\|[\w\])]!(?=[.\[)])` | `any` or a non-null `!` that silences the type checker instead of narrowing the type. |
| `suppression` | cleanliness | Nên sửa | js,jsx,ts,tsx,mjs,cjs,vue,py,go,rb,java,kt,swift,rs,php,cs,sh,css,scss,less | `eslint-disable\|@ts-ignore\|@ts-nocheck\|@ts-expect-error\|#\s*type:\s*ignore\|#\s*noqa\|#\s*pylint:\s*disable` | A new lint or type suppression. |
| `todo-without-owner` | cleanliness | Tuỳ chọn | js,jsx,ts,tsx,mjs,cjs,vue,py,go,rb,java,kt,swift,rs,php,cs,sh,css,scss,less | `\b(TODO\|FIXME\|HACK\|XXX)\b(?!\s*[(\[]\s*[@#\w-]+\s*[)\]])` | A TODO with no owner or issue, such as `TODO(@name)` or `TODO[#12]`. |
| `magic-number` | cleanliness | Tuỳ chọn | js,jsx,ts,tsx,mjs,cjs,vue,py | `builtin:magic-number` | An unnamed number of two or more digits in logic, outside `magic-number-allow`, indexes and slices, constant declarations, and tests. |
| `oversized-function` | cleanliness | Tuỳ chọn | js,jsx,ts,tsx,mjs,cjs | `builtin:function-size` | A function added by this change that is longer than `max-function-lines`. |
| `oversized-file` | cleanliness | Tuỳ chọn | js,jsx,ts,tsx,mjs,cjs,vue,py,go,rb,java,kt,swift,rs,css,scss | `builtin:file-size` | A source file this change pushed past `max-file-lines`. |
| `hardcoded-style` | frontend-specific | Nên sửa | css,scss,less,js,jsx,ts,tsx,vue | `builtin:hardcoded-style` | A literal color, or a pixel spacing value, while the project defines design tokens for it. |
| `hardcoded-ui-string` | frontend-specific | Nên sửa | jsx,tsx,vue | `builtin:hardcoded-ui-string` | Visible UI text written inline while the project uses i18n. |
| `formatting-noise` | diff hygiene | Tuỳ chọn | js,jsx,ts,tsx,mjs,cjs,vue,py,go,rb,java,kt,swift,rs,php,cs,sh,css,scss,less | `builtin:formatting-noise` | Whitespace-only edits or reordered imports mixed into the change. |
| `reinvented-helper` | redundancy | Nên sửa | * | `judgment` | A new helper, hook, or component that duplicates an existing one. Name the existing equivalent and its path; no equivalent, no finding. |
| `unnecessary-abstraction` | abstraction | Tuỳ chọn | * | `judgment` | A wrapper with one caller, an interface with one implementation, or configuration for a single value. Quote the definition and name its only use. |
| `impossible-defensive-check` | abstraction | Tuỳ chọn | * | `judgment` | A guard for a state the types or the caller already rule out. Quote the guard and the line that rules it out. |
| `log-and-rethrow` | abstraction | Tuỳ chọn | * | `judgment` | A `try/catch` that only logs and rethrows. Quote it. |
| `error-hiding-fallback` | abstraction | Nên sửa | * | `judgment` | A fallback that swallows an error the user or caller needs to see. Quote it and name what is lost. |
| `memo-overuse` | frontend-specific | Tuỳ chọn | jsx,tsx | `judgment` | `useMemo` or `useCallback` around a cheap value with no memoized consumer. Quote it. |
| `pattern-inconsistency` | pattern consistency | Nên sửa | * | `judgment` | The change does a job differently from the project: data fetching, state, error handling, styling, import aliases, file location, naming, or test style. Cite 2–3 existing files that do the same job the other way; no precedent, no finding. |
