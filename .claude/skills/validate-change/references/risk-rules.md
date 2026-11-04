# Risk rules

This file is project-customizable: add, remove, or reword rules, change a level, or tune a setting. An edited copy is kept by `update --apply`.
`scripts/validate_change.py risk` reads the settings and the rules table below; editing them changes the next run without touching `SKILL.md`.
The rules are deterministic, so the same diff and the same expectation list always give the same gate. The thresholds are starting values; calibrate them on the project's own changes.

Keep only rules that decide the human gate and the independent audit (money, data, permissions, weakened tests, size, shared files, configuration, intent).
Security and performance detection for `Cần test riêng` comes from the installed `security-performance-check` signal files, not from duplicate rows here.

Levels:

- `high`: money, data, permissions, or weakened tests. Asks the human to confirm the expectations and flows before checks run, and adds the independent audit.
- `gate`: large or wide changes, configuration, and unconfirmed intent. Asks the human to confirm before checks run.
- `advisory`: listed in the report only.

Scopes:

- `path`: a regular expression matched against each changed file path.
- `added`, `removed`, `changed`: a regular expression matched against each added line, each removed line, or both.
- `builtin`: a check a single regular expression cannot express.

A regular expression is Python syntax; start it with `(?i)` to ignore case, and write a literal `|` as `\|` inside the table.
Files under `ignore` are left out of every rule and every count.

## Settings

- ignore: package-lock.json, yarn.lock, pnpm-lock.yaml, *.min.js, *.map, *.snap, dist/**, build/**, coverage/**, node_modules/**
- tests: *.test.*, *.spec.*, test/**, tests/**, e2e/**, __tests__/**
- max-lines: 500
- max-files: 25
- shared:

## Rules

| ID | Level | Scope | Check | What |
| --- | --- | --- | --- | --- |
| `money-path` | high | path | `(?i)(^\|[/_.-])(payments?\|payouts?\|billing\|refunds?\|invoices?\|checkout\|pricing\|wallets?\|subscriptions?)` | A file about payments, billing, refunds, or pricing. |
| `data-path` | high | path | `(?i)(^\|/)(migrations?\|migrate\|prisma)/\|\.sql$\|(^\|/)(schema\.prisma\|models?\.py)$` | A migration, SQL file, or ORM schema. |
| `permission-path` | high | path | `(?i)(^\|[/_.-])(auth\|authz\|permissions?\|roles?\|polic(y\|ies)\|acl\|rbac\|guards?)([/_.A-Z-]\|$)` | A file about authentication, roles, or access policy. |
| `ci-path` | high | path | `(^\|/)\.github/workflows/\|(^\|/)CODEOWNERS$` | A CI workflow or code-owner rule. |
| `destructive-sql` | high | added | `(?i)\b(drop\s+(table\|column\|database\|index)\|truncate\|alter\s+table\|delete\s+from)\b` | A statement that drops, truncates, alters, or deletes stored data. |
| `access-check` | high | changed | `\b(isAdmin\|authorize\|requireRole\|hasRole\|hasPermission\|canAccess\|checkPermission\|verifyToken\|jwt\|bcrypt\|csrf)\b` | An access check or credential handling added or removed. |
| `money-math` | high | changed | `(?i)(amount\|currency\|refund\|charge\|discount\|subtotal\|price)\w*\s*(=[^=>]\|[*+/-]\s*[\w(]\|[<>]=?\s*\d)` | Arithmetic, assignment, or a limit on a money value. |
| `tests-skipped` | high | added | `\b(it\|test\|describe)\.(skip\|only\|todo)\(\|\bx(it\|describe)\(\|@pytest\.mark\.skip` | A test skipped, focused, or left as a todo. |
| `tests-deleted` | high | builtin | `builtin:tests-deleted` | A test file deleted by the change; a renamed one does not count. |
| `size` | gate | builtin | `builtin:size` | The change is larger than `max-lines` changed lines or `max-files` files. |
| `shared` | gate | builtin | `builtin:shared` | A file matching the `shared` setting, such as a design-system component or a utility many routes import. |
| `env-file` | gate | path | `(^\|/)\.env(\.\|$)` | An environment file. |
| `env-var` | gate | added | `process\.env\.\w+\|import\.meta\.env\.\w+\|os\.environ\|getenv\(` | Code that reads an environment variable. |
| `dependency-major` | gate | builtin | `builtin:dependency-major` | A dependency in a `package.json` dependency section moved to a new major version. |
| `agent-intent-only` | gate | builtin | `builtin:agent-intent-only` | No expectation comes from a human prompt or spec. |
| `intent-conflict` | gate | builtin | `builtin:intent-conflict` | The expectation list records a conflict between sources; the human resolves it at the gate. |
| `flag-default` | advisory | changed | `(?i)\b\w*(feature\|flag\|toggle)\w*\s*[:=]\s*(true\|false)\b` | A feature-flag default set or flipped. |
