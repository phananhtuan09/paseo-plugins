---
name: quality-code-check
description: Use when the task involves linting, type checking, build verification, or debugging failing validation, or when asked to review code quality or clean up AI-written code (noisy comments, ignored project patterns, reinvented helpers, unnecessary abstraction, diff noise). Prefer project-native commands and focused checks before broad fixes.
---

# Quality Code Check

## Purpose
Establish consistent code quality standards through automated validation tools, ensuring code reliability, maintainability, and consistency.

## Scope And Authority

Follow repository instructions, existing scripts, configuration, and the requested scope.
For check, review, or diagnosis requests, use non-mutating validation and report findings.
Apply fixes only when implementation or repair is authorized.
Preserve existing edits and distinguish regressions caused by the change from pre-existing or environment failures.
Do not change compiler strictness, warning thresholds, dependencies, or unrelated formatting as part of ordinary validation.
Choose the cheapest reliable checks for affected behavior and consumers.
Lint, types, and builds supplement behavioral proof; they do not establish that a feature works.
Do not create a plan or validation artifact for bounded work unless requested.

---

## Core Principle

Code quality validation is a safety gate that catches errors early, prevents tech debt accumulation, and ensures code meets project standards.

---

## Quality Check Categories

### 1. Linting - Code Style & Best Practices

**What linting detects:**
- Code style violations (indentation, spacing, naming)
- Unused variables and imports
- Missing error handling patterns
- Potentially dangerous patterns
- Code complexity issues

**Language-specific tools:**
- **JavaScript/TypeScript**: ESLint
- **Python**: Ruff, Flake8
- **Go**: golangci-lint
- **Rust**: Clippy
- **Java**: Spotbugs, Checkstyle

**Approach:**
- Run linting on all modified files
- When fixes are authorized, scope auto-fixes to affected code and review their diff
- Repair remaining in-scope errors when authorized; otherwise report them
- Minimize warnings to project standards

---

### 2. Type Checking - Type Safety

**What type checking validates:**
- Type consistency
- Function parameter and return types
- Null/undefined safety
- Generic type parameters

**Language-specific tools:**
- **TypeScript**: `tsc --noEmit`
- **Python**: MyPy, Pyright
- **Go**: Compiler (built-in)
- **Rust**: Compiler (built-in)
- **Java**: Compiler (built-in)

**Approach:**
- Use the repository's existing type-check configuration
- Run on all modified code
- Repair in-scope type errors when authorized; otherwise report them
- Follow existing annotation conventions

---

### 3. Build Verification - Compilability & Packaging

**What build checking validates:**
- Code compiles without errors
- All imports and dependencies resolve
- Asset bundling completes
- Runtime entry points exist

**Language-specific tools:**
- **JavaScript/TypeScript**: Webpack, Vite, or `npm run build`
- **Python**: `python -m py_compile` or test imports
- **Go**: `go build ./...`
- **Rust**: `cargo build`
- **Java**: Maven (`mvn compile`), Gradle (`gradle build`)

**Approach:**
- Run a build when the affected boundary or repository requirements make it relevant
- Use the existing build configuration and the smallest reliable package or project scope
- Report failing or unavailable build steps honestly

---

### 4. Surface review - AI-written code that tools pass

Lint, type checks, and builds do not catch surface problems that AI implementers often leave behind: noisy comments, code that ignores project patterns, reinvented helpers, unnecessary abstraction, and diff noise.
`review-pr` excludes style on purpose, so this layer belongs here. Its risk is subjective, noisy output, so every finding needs evidence.

**Rules:**
- Review only lines the change adds or modifies. Never report pre-existing code.
- **Pattern inconsistency needs precedent:** cite 2–3 existing project files that do the same job the other way, for example "data fetching uses `useQuery` in `OrderList.tsx` and `UserList.tsx`; this change uses `useEffect` + `fetch`". No precedent, no finding.
- **Redundant or reinvented code needs the existing equivalent:** search for an equivalent of each new helper, hook, or component and name it with its path, for example "`formatDate()` already exists in `utils/date.ts`". No equivalent, no finding.
- Every other judgment finding quotes the diff line it is about.
- A finding is `Nên sửa` or `Tuỳ chọn`, never a merge blocker by itself.

**Two layers, both driven by `references/surface-rules.md`:**
- *Deterministic scan* (no tokens): `node <skill-dir>/scripts/surface-scan.cjs --root . --base <base-ref>` reads the change's diff (or `--diff <file>`, `-` for stdin) and applies the rules whose check is a regex or a `builtin:` scan, such as commented-out code, changelog-style comments, debug statements, `as any` and non-null `!`, new suppressions, TODOs without an owner, oversized functions and files, magic numbers, hardcoded colors or spacing when the project defines design tokens, hardcoded UI text when the project uses i18n, and whitespace-only edits or moved imports. Add `--format md` for the report section. Without `--base` or `--diff` it scans the uncommitted changes against `HEAD`; untracked files are not in a diff, so stage them with `git add -N` first.
- *Judgment layer:* walk the rules whose check is `judgment` while reading the diff (comments restating code, unnecessary abstraction, impossible defensive checks, log-and-rethrow, error-hiding fallbacks, `useMemo`/`useCallback` overuse, pattern inconsistency, reinvented helpers). The scan lists them in its output.

The scan is a lead, not a verdict: drop a scan item that the surrounding code shows is intended, such as a command-line tool that prints on purpose, and say so in one line.
`references/surface-rules.md` is project-customizable: rules, levels, file types, and settings such as the cap and size limits can be edited per project, and the edit survives `update --apply`.

**Fixing:** report only when called from a composite validation step or a review. Standalone, apply only mechanical fixes (remove commented-out code and debug statements) and only when fixing is authorized; everything else is reported.

---

## Tool Invocation

**Note:** Commands are examples. Adjust to your project's package manager, config files, and scripts.

### Project Detection

**Use Glob to detect project type:**
- Glob(pattern="`**`/package.json") → JavaScript/TypeScript
- Glob(pattern="`**`/pyproject.toml") or Glob(pattern="`**`/requirements.txt") → Python
- Glob(pattern="`**`/go.mod") → Go
- Glob(pattern="`**`/Cargo.toml") → Rust
- Glob(pattern="`**`/pom.xml") or Glob(pattern="`**`/build.gradle") → Java

### Language-Specific Commands

#### JavaScript/TypeScript

```bash
# Check package.json scripts first
npm run lint
npx eslint . --max-warnings=0

# Type checking
npm run typecheck
npx tsc --noEmit

# Build
npm run build
```

#### Python

```bash
# Linting
ruff check .
ruff check . --fix  # auto-fix

# Type checking
mypy .
pyright

# Import check
python -c 'import your_package'
```

#### Go

```bash
# Linting
golangci-lint run
go vet ./...

# Build (includes type checking)
go build ./...
```

#### Rust

```bash
# Linting
cargo clippy -- -D warnings

# Type checking
cargo check

# Build
cargo build
cargo build --release  # production
```

#### Java

```bash
# Gradle
./gradlew check
./gradlew build

# Maven
mvn verify
mvn compile
```

### Error Handling

**Tool not found:**
- Try command, catch error
- If not found: Skip check, notify user
- Continue with remaining checks

**Check fails:**
- Parse error output
- Report specific violations
- Suggest fixes based on error type
- Retry after fixes

---

## Validation Workflow

### When to Run

- After implementation is stable enough
- Before creating pull requests or commits
- When user explicitly requests
- Incrementally during development (optional)

### Quality Check Sequence

1. **Detect available tools** from project configuration
   - Use Glob to find config files
   - Identify which tools are available

2. **Run linting** (scoped to changed files when possible)
   - Execute appropriate commands
   - Use non-mutating mode for review requests
   - Repair in-scope violations only when fixes are authorized
   - Target: Meet project's warning standards

3. **Run type checks**
   - Execute appropriate commands
   - Distinguish in-scope regressions from pre-existing failures
   - Validate type consistency across modules
   - Target: No type errors

4. **Run build when relevant or required** (use repository configuration)
   - Execute appropriate commands
   - Ensure all code compiles
   - Validate all imports resolve
   - Confirm output artifacts generated
   - Target: Build succeeds without critical errors

5. **Run the surface review when the request covers code quality or AI-written code**
   - Run `scripts/surface-scan.cjs` on the change's diff, then walk the judgment rules
   - Keep only findings with the evidence their rule names
   - Report it after lint, types, and build; it never changes their results or blocks on its own

### Surface review output

Write the section in Vietnamese, after the lint, type, and build results.
List at most the rules file's `cap` items (10 by default), `Nên sửa` first and grouped by type, and summarize the rest as a count per type.

```markdown
## Bề mặt code

| Loại | Vị trí | Bằng chứng | Mức |
| --- | --- | --- | --- |
| pattern consistency | `src/pages/InvoicePage.tsx:12` | Data fetching uses `useQuery` in `src/pages/OrderList.tsx` and `src/pages/UserList.tsx`; this change uses `useEffect` + `fetch`. | Nên sửa |
| redundancy | `src/lib/dates.ts:3` | `formatDay()` duplicates `formatDate()` in `src/utils/date.ts`. | Nên sửa |
| comments | `src/pages/InvoicePage.tsx:40` | `// set loading to true` restates `setLoading(true)`. | Tuỳ chọn |

Còn 3 phát hiện khác không hiển thị: cleanliness 2, comments 1.
```

When nothing meets the bar, write `Không có phát hiện bề mặt cần báo trên các dòng thay đổi.` under the heading.

### Error Recovery

**If quality checks fail:**
1. **Analyze errors** - Identify root causes
2. **Fix issues when authorized** - Make minimal in-scope corrections; otherwise report
3. **Re-run checks** - Execute same commands again
4. **Repeat only with new evidence or a meaningful correction** - Do not rerun unchanged failures indefinitely

**If unable to fix:**
- Document the issue and root cause
- Mark as blocked if preventing progress
- Escalate or ask user for guidance

---

## Common Mistakes

1. **Ignoring warnings** - Warnings often indicate real problems
   → Fix them or understand why acceptable
2. **Only checking one file** - Changes can break type checking across others
   → Check all modified files and dependencies
3. **Skipping the build step** - Code might lint/type-check but fail to compile
   → Build when compilation, packaging, entry points, or repository rules require it
4. **Accepting auto-fixes blindly** - Auto-fixes might hide real issues
   → Review each auto-fix before committing
5. **Not checking package.json scripts** - Projects often define custom commands
   → Check scripts first before running tools directly
6. **Inconsistent standards** - Allowing different levels across features
   → Maintain consistent standards for your project

---

## Validation Checklist

Before considering quality checks complete:

Apply only the checks relevant to the requested scope or required by the repository.
Report each selected check as passed, failed, or unavailable, including commands actually run.
Do not present skipped checks as passed or suppress errors to obtain a clean result.
- [ ] Code is stable enough to validate
- [ ] Linting tool runs successfully on changed files
- [ ] Lint warnings minimized to project-acceptable levels
- [ ] Type checking tool runs successfully
- [ ] No critical type errors remain
- [ ] Build completes successfully
- [ ] No critical build errors present
- [ ] Warnings at project-acceptable levels
- [ ] All blocking issues fixed or escalated
- [ ] Surface review, when requested, reports only changed lines with the evidence each rule needs

---

## Key Takeaway

**Systematic quality validation catches issues early and maintains consistency.**

Quality checks are flexible gates that validate code against project standards:
- Run when code is stable enough
- Adjust tool commands to your project's needs
- Target project-appropriate warning levels
- Use as validation before PRs, commits, or deployment

Commands shown are examples - check your project's scripts first. Quality standards should be consistent within your project but may vary between projects.

Systematic checks catch errors early, prevent tech debt accumulation, and build confidence in code readiness.
