#!/usr/bin/env python3
"""Deterministic parts of a validate-change run: the risk gate, the run files' contracts, coverage, and the overall status."""
import argparse
import hashlib
import importlib.util
import json
import random
import re
import subprocess
import sys
from pathlib import Path

RULES = Path(__file__).resolve().parents[1] / "references" / "risk-rules.md"
SKILLS_ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = SKILLS_ROOT / "runtime-e2e-test" / "scripts" / "evidence.py"
SPC_ROOT = SKILLS_ROOT / "security-performance-check"
SPC_CHECK = SPC_ROOT / "scripts" / "check_findings.py"
SPC_SECURITY_SIGNALS = SPC_ROOT / "references" / "security-signals.md"
SPC_PERFORMANCE_SIGNALS = SPC_ROOT / "references" / "performance-signals.md"
SURFACE_SCAN = SKILLS_ROOT / "quality-code-check" / "scripts" / "surface-scan.cjs"
LEVELS = ("high", "gate", "advisory")
SCOPES = ("path", "added", "removed", "changed", "builtin")
BUILTINS = ("size", "shared", "tests-deleted", "dependency-major", "agent-intent-only", "intent-conflict")
INTENT_BUILTINS = ("agent-intent-only", "intent-conflict")
CHANGES = ("added", "modified", "removed", "unchanged")
SOURCES = ("prompt", "spec", "assumption", "agent-intent")
STEPS = ("quality-code-check", "review-pr", "runtime-e2e-test", "audit", "security-performance-check")
REQUIRED_STEPS = ("quality-code-check", "review-pr", "runtime-e2e-test")
STEP_STATUSES = ("RAN", "SKIPPED", "MISSING")
SKIPS = ("build-failed", "no-human", "not-applicable", "recommended", "no-signal")
CHECK_KINDS = ("build", "lint", "typecheck", "test", "surface")
REVIEW_STATUSES = {
    "Có thể merge": "PASSED",
    "Chưa thể merge — cần sửa": "FAILED",
    "Chưa thể kết luận — cần quyết định": "NEEDS_REVIEW",
    "Không thể đánh giá": "BLOCKED",
}
VERDICTS = ("SUPPORTED", "UNSUPPORTED", "CONTRADICTED", "MISSING")
AREAS = ("security", "performance", "accessibility")
# Worst wins: the overall status is the first of these that any section reaches.
ORDER = ("NEEDS_HUMAN", "BLOCKED", "FAILED", "NEEDS_REVIEW", "PASSED")
LABELS = {
    "NEEDS_HUMAN": "Cần human xác nhận trước khi chạy",
    "BLOCKED": "Bị chặn",
    "FAILED": "Không đạt",
    "NEEDS_REVIEW": "Cần human review",
    "PASSED": "Đạt",
}


class Inconsistent(ValueError):
    """The run files contradict each other or their contract; the report cannot be trusted."""


def load(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise Inconsistent(f"{path}: {error}") from None


def write(path, data):
    Path(path).write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def git(root, *args):
    done = subprocess.run(["git", "-c", "core.quotePath=off", *args], cwd=root, capture_output=True, text=True)
    if done.returncode:
        raise Inconsistent(f"git {' '.join(args)}: {done.stderr.strip()[:300]}")
    return done.stdout


# ---------- rules ----------

def cells(line):
    """Split a Markdown table row on unescaped pipes and unescape `\\|`."""
    parts = re.split(r"(?<!\\)\|", line.strip().strip("|"))
    return [p.strip().replace("\\|", "|") for p in parts]


def glob_regex(pattern):
    """A glob where `**` crosses directories and `*` does not; a pattern without `/` matches the file name."""
    out, i = "", 0
    while i < len(pattern):
        if pattern.startswith("**/", i):
            out, i = out + "(?:.*/)?", i + 3
        elif pattern.startswith("**", i):
            out, i = out + ".*", i + 2
        elif pattern[i] == "*":
            out, i = out + "[^/]*", i + 1
        elif pattern[i] == "?":
            out, i = out + "[^/]", i + 1
        else:
            out, i = out + re.escape(pattern[i]), i + 1
    return re.compile(("(?:^|.*/)" if "/" not in pattern else "^") + out + "$")


def matcher(patterns):
    compiled = [glob_regex(p) for p in patterns]
    return lambda path: any(r.match(path) for r in compiled)


def load_rules(path=RULES):
    text = Path(path).read_text(encoding="utf-8")
    settings, rules, section = {}, [], None
    for line in text.splitlines():
        if line.startswith("## "):
            section = line[3:].strip().lower()
            continue
        if section == "settings":
            found = re.match(r"^- ([a-z-]+):\s*(.*)$", line)
            if found:
                settings[found.group(1)] = found.group(2).strip()
        elif section == "rules" and line.startswith("|"):
            row = cells(line)
            if row[0] == "ID" or set(row[0]) <= {"-", " "}:
                continue
            if len(row) != 5:
                raise Inconsistent(f"{path}: a rule row needs ID, Level, Scope, Check, What: {line}")
            rule_id, level, scope, check, what = (c.strip("`") if i in (0, 3) else c for i, c in enumerate(row))
            if level not in LEVELS or scope not in SCOPES:
                raise Inconsistent(f"{path}: rule {rule_id}: level is one of {', '.join(LEVELS)} and scope one of {', '.join(SCOPES)}")
            if any(r["id"] == rule_id for r in rules):
                raise Inconsistent(f"{path}: rule {rule_id} is repeated")
            if scope == "builtin":
                name = check[len("builtin:"):] if check.startswith("builtin:") else None
                if name not in BUILTINS:
                    raise Inconsistent(f"{path}: rule {rule_id}: builtin is one of {', '.join(BUILTINS)}")
                pattern = name
            else:
                try:
                    pattern = re.compile(check)
                except re.error as error:
                    raise Inconsistent(f"{path}: rule {rule_id}: {error}") from None
            rules.append({"id": rule_id, "level": level, "scope": scope, "check": pattern, "what": what})
    split = lambda key: [p.strip() for p in settings.get(key, "").split(",") if p.strip()]
    try:
        limits = {"max-lines": int(settings.get("max-lines", "500")), "max-files": int(settings.get("max-files", "25"))}
    except ValueError:
        raise Inconsistent(f"{path}: max-lines and max-files must be integers") from None
    return {"ignore": split("ignore"), "tests": split("tests"), "shared": split("shared"), **limits}, rules


# ---------- diff ----------

def unquote(path):
    """Decode a C-quoted git path, which git writes for names with quotes, backslashes, or control characters."""
    if not (len(path) > 1 and path[0] == '"' and path[-1] == '"'):
        return path
    raw, out, i = path[1:-1].encode("utf-8"), bytearray(), 0
    simple = {ord("n"): 10, ord("t"): 9, ord("r"): 13, ord("a"): 7, ord("b"): 8, ord("f"): 12, ord("v"): 11}
    while i < len(raw):
        if raw[i] == 92 and i + 1 < len(raw):
            digits = raw[i + 1:i + 4]
            if len(digits) == 3 and all(48 <= d <= 55 for d in digits):
                out.append(int(digits, 8))
                i += 4
            else:
                out.append(simple.get(raw[i + 1], raw[i + 1]))
                i += 2
        else:
            out.append(raw[i])
            i += 1
    return out.decode("utf-8", "replace")


def read_diff(root, base, worktree, untracked=None):
    """Files of the change with their added and removed lines, and whether each was deleted or renamed away.

    With `worktree`, untracked files count as added; `untracked` limits them to a list recorded earlier.
    """
    ref = [base] if worktree else [f"{base}...HEAD"]
    text = git(root, "diff", "--no-color", "--no-renames", "--no-ext-diff", "-U0", *ref)
    files, current, header, old = {}, None, False, None
    for line in text.splitlines():
        if line.startswith("diff --git "):
            current, header, old = None, True, None
        elif header and line.startswith("@@"):
            header = False
        # Inside a hunk, a removed "-- x" reads "--- x" and an added "++ x" reads "+++ x"; only the header names files.
        elif header and line.startswith("--- "):
            old = None if line[4:] == "/dev/null" else unquote(line[4:])[2:]
        elif header and line.startswith("+++ "):
            new = None if line[4:] == "/dev/null" else unquote(line[4:])[2:]
            current = files.setdefault(new or old, {"added": [], "removed": [], "deleted": new is None, "renamed": False})
        elif current is not None and not header and line.startswith("+"):
            current["added"].append(line[1:])
        elif current is not None and not header and line.startswith("-"):
            current["removed"].append(line[1:])
    # Binary files and mode-only changes carry no hunks, so they come from the name list.
    for name in git(root, "diff", "--name-only", "--no-renames", *ref).splitlines():
        files.setdefault(unquote(name), {"added": [], "removed": [], "deleted": False, "renamed": False})
    fields = git(root, "diff", "--name-status", "-M", "-z", *ref).split("\0")
    i = 0
    while i < len(fields) - 1:
        if fields[i].startswith("R"):
            if fields[i + 1] in files:
                files[fields[i + 1]]["renamed"] = True
            i += 3
        else:
            i += 2
    found = []
    if worktree:
        listed = [n for n in git(root, "ls-files", "--others", "--exclude-standard", "-z").split("\0") if n]
        found = sorted(n for n in listed if untracked is None or n in untracked)
        for name in found:
            try:
                lines = (root / name).read_text(encoding="utf-8").splitlines()
            except (OSError, UnicodeDecodeError):
                lines = []
            files[name] = {"added": lines, "removed": [], "deleted": False, "renamed": False}
    return files, found


def major(version):
    found = re.search(r"\d+", version)
    return int(found.group()) if found else None


DEPENDENCY_SECTIONS = ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies")


def declared(text):
    """Dependency versions a package.json declares, or none when it is missing or not JSON."""
    try:
        data = json.loads(text) if text else {}
    except ValueError:
        return {}
    sections = [data.get(key) for key in DEPENDENCY_SECTIONS] if isinstance(data, dict) else []
    return {name: version for section in sections if isinstance(section, dict) for name, version in section.items() if isinstance(version, str)}


def dependency_majors(before_text, after_text):
    """Dependencies whose declared major version differs between the base and the new package.json."""
    before, after = declared(before_text), declared(after_text)
    return [f"{name} {before[name]} → {after[name]}" for name in sorted(set(before) & set(after))
            if major(before[name]) is not None and major(after[name]) is not None and major(before[name]) != major(after[name])]


def show(root, revision, name):
    done = subprocess.run(["git", "show", f"{revision}:{name}"], cwd=root, capture_output=True, text=True)
    return done.stdout if done.returncode == 0 else ""


def diff_signals(files, settings, rules, versions):
    """Rules the diff itself triggers; intent rules are evaluated separately from the expectation list."""
    ignored, tests, shared = matcher(settings["ignore"]), matcher(settings["tests"]), matcher(settings["shared"])
    kept = {name: change for name, change in sorted(files.items()) if not ignored(name)}
    lines = sum(len(c["added"]) + len(c["removed"]) for c in kept.values())
    signals = []
    for rule in rules:
        hits = []
        if rule["scope"] == "path":
            hits = [name for name in kept if rule["check"].search(name)]
        elif rule["scope"] in ("added", "removed", "changed"):
            sides = ("added", "removed") if rule["scope"] == "changed" else (rule["scope"],)
            for name, change in kept.items():
                for side in sides:
                    hits += [f"{name}: {'+' if side == 'added' else '-'}{line.strip()[:120]}" for line in change[side] if rule["check"].search(line)]
        elif rule["check"] == "size":
            if lines > settings["max-lines"] or len(kept) > settings["max-files"]:
                hits = [f"{lines} changed lines, {len(kept)} files (limits {settings['max-lines']} lines, {settings['max-files']} files)"]
        elif rule["check"] == "shared":
            hits = [name for name in kept if settings["shared"] and shared(name)]
        elif rule["check"] == "tests-deleted":
            hits = [name for name, change in kept.items() if change["deleted"] and not change["renamed"] and tests(name)]
        elif rule["check"] == "dependency-major":
            hits = [f"{name}: {d}" for name in kept if Path(name).name == "package.json" for d in dependency_majors(*versions(name))]
        if hits:
            signals.append({"rule": rule["id"], "level": rule["level"], "what": rule["what"], "count": len(hits), "hits": hits[:5]})
    return signals, {"files": len(kept), "lines": lines}


def intent_signals(expectations, rules):
    items, conflicts = expectations["items"], expectations.get("conflicts", [])
    found = {
        "agent-intent-only": [] if any(i["source"] in ("prompt", "spec") for i in items) else ["no item comes from a human prompt or spec"],
        "intent-conflict": [f"{c['id']}: {', '.join(c['items'])}" for c in conflicts],
    }
    return [{"rule": r["id"], "level": r["level"], "what": r["what"], "count": len(found[r["check"]]), "hits": found[r["check"]][:5]}
            for r in rules if r["scope"] == "builtin" and r["check"] in INTENT_BUILTINS and found[r["check"]]]


def spc_installed():
    """True when security-performance-check sits beside this skill with its signal files."""
    return SPC_CHECK.is_file() and SPC_SECURITY_SIGNALS.is_file() and SPC_PERFORMANCE_SIGNALS.is_file()


def load_spc_checker():
    """Load check_findings.py from the installed sibling skill; no local copy of signal data."""
    if not spc_installed():
        return None
    spec = importlib.util.spec_from_file_location("spc_check_findings", SPC_CHECK)
    if spec is None or spec.loader is None:
        raise Inconsistent(f"cannot load {SPC_CHECK}")
    mod = importlib.util.module_from_spec(spec)
    # The checker lives in the project's installed skill; keep its bytecode out of the project tree.
    writes_bytecode, sys.dont_write_bytecode = sys.dont_write_bytecode, True
    try:
        spec.loader.exec_module(mod)
    finally:
        sys.dont_write_bytecode = writes_bytecode
    return mod


def separate_tests_from_signals(paths, changes=None):
    """Recommend security-performance-check from the changed code, in any language.

    Every signal row is considered. A row is reported when a content hint is found in a changed
    file's added or removed lines (`changes`), wherever the file lives. A path hint alone counts
    only for a file with no changed text or a row with no content hints, because directory globs
    such as `**/app/**` or `**/controllers/**` match whole frameworks regardless of the change.
    """
    checker = load_spc_checker()
    if checker is None:
        return []
    path_list = list(paths)
    entries = []
    try:
        tracks = (
            ("security", checker.load_signals(SPC_SECURITY_SIGNALS)),
            ("performance", checker.load_performance_signals(SPC_PERFORMANCE_SIGNALS)),
        )
        for area, rows in tracks:
            for row_id, hits in checker.hinted_paths(rows, path_list, changes, content_required=True).items():
                extra = f" +{len(hits) - 1}" if len(hits) > 1 else ""
                entries.append({
                    "area": area,
                    "signal": f"{row_id}: {hits[0]}{extra}",
                    "command": f"/security-performance-check {area}",
                })
    except (ValueError, OSError) as error:
        # Parser/file errors (including check_findings.Inconsistent) become risk-step inconsistencies;
        # other exceptions (bugs) propagate.
        raise Inconsistent(f"security-performance-check signal files: {error}") from None
    return entries


def diff_changes(files):
    """{path: changed lines} from read_diff, for content hints."""
    return {name: "\n".join(info["added"] + info["removed"]) for name, info in files.items()}


def assess(root, base, worktree, expectations, rules_path, untracked=None):
    settings, rules = load_rules(rules_path)
    base_sha = git(root, "rev-parse", base if worktree else git(root, "merge-base", base, "HEAD").strip()).strip()

    def versions(name):
        after = (root / name).read_text(encoding="utf-8") if worktree and (root / name).is_file() else show(root, "HEAD", name)
        return show(root, base_sha, name), after

    files, found = read_diff(root, base, worktree, untracked)
    signals, size = diff_signals(files, settings, rules, versions)
    signals += intent_signals(expectations, rules)
    levels = {s["level"] for s in signals}
    ignored = matcher(settings["ignore"])
    kept_paths = [name for name in sorted(files) if not ignored(name)]
    separate = separate_tests_from_signals(kept_paths, diff_changes(files))
    return {
        "schema": "validate-change/risk@1",
        "base": base,
        "baseSha": base_sha,
        "headSha": git(root, "rev-parse", "HEAD").strip(),
        "worktree": worktree,
        "untracked": found,
        "rulesDigest": hashlib.sha256(Path(rules_path).read_bytes()).hexdigest(),
        **size,
        "signals": signals,
        "separateTests": separate,
        "gate": "required" if levels & {"high", "gate"} else "not-required",
        "audit": "required" if "high" in levels else "not-required",
    }


# ---------- contracts ----------

def text(value):
    return isinstance(value, str) and value.strip() != ""


def ids_of(entries, prefix, where):
    ids = [e.get("id") for e in entries]
    if any(not isinstance(i, str) or not re.fullmatch(prefix + r"[0-9]+", i) for i in ids) or len(ids) != len(set(ids)):
        raise Inconsistent(f"{where}: ids must be unique and look like {prefix}1, {prefix}2, ...")
    return set(ids)


def refs(value, known, where):
    if not isinstance(value, list) or any(r not in known for r in value):
        raise Inconsistent(f"{where}: refs must list known ids ({', '.join(sorted(known)) or 'none'})")
    return value


def check_expectations(data):
    if data.get("schema") != "validate-change/expectations@1" or not isinstance(data.get("items"), list) or not data["items"]:
        raise Inconsistent("expectations.json: schema validate-change/expectations@1 with at least one item")
    known = ids_of(data["items"], "K", "expectations.json items")
    for item in data["items"]:
        where = f"expectations.json {item['id']}"
        if not text(item.get("statement")) or item.get("change") not in CHANGES or item.get("source") not in SOURCES or not text(item.get("sourceRef")):
            raise Inconsistent(f"{where}: needs statement, change ({'|'.join(CHANGES)}), source ({'|'.join(SOURCES)}), sourceRef")
        human = item["source"] in ("prompt", "spec")
        if human and (not text(item.get("quote")) or len(item["quote"]) > 300):
            raise Inconsistent(f"{where}: a {item['source']} item quotes its source verbatim, at most 300 characters")
        if item["source"] == "assumption" and not text(item.get("default")):
            raise Inconsistent(f"{where}: an assumption records the default it chose")
        if item.get("confirmed") not in (("source",) if human else ("gate", "none")):
            raise Inconsistent(f"{where}: confirmed is source for prompt and spec items, gate or none otherwise")
        # The PR description is the implementer's own account; it can only ever be agent intent.
        if item["sourceRef"].startswith("pr-description") and item["source"] != "agent-intent":
            raise Inconsistent(f"{where}: an item taken from the PR description is agent-intent")
    conflicts = data.get("conflicts", [])
    if not isinstance(conflicts, list):
        raise Inconsistent("expectations.json conflicts must be a list")
    ids_of(conflicts, "C", "expectations.json conflicts")
    for conflict in conflicts:
        members = refs(conflict.get("items"), known, f"expectations.json {conflict['id']}")
        if len(set(members)) < 2 or not text(conflict.get("summary")):
            raise Inconsistent(f"expectations.json {conflict['id']}: a conflict names two or more items and a summary")
        if conflict.get("resolution") != "unresolved" and conflict.get("resolution") not in members:
            raise Inconsistent(f"expectations.json {conflict['id']}: resolution is unresolved or the item the human chose")
    return known


def check_run(data):
    if data.get("schema") != "validate-change/run@1" or not isinstance(data.get("target"), dict) or not text(data["target"].get("label")):
        raise Inconsistent("run.json: schema validate-change/run@1 with target.label")
    gate = data.get("gate")
    if not isinstance(gate, dict) or gate.get("override") not in (None, "always", "never") or gate.get("answer") not in (None, "confirmed", "edited", "no-human"):
        raise Inconsistent("run.json gate: override is null, always or never; answer is null, confirmed, edited or no-human")
    steps = data.get("steps")
    if not isinstance(steps, list) or [s.get("skill") for s in steps] != [s for s in STEPS if s in {x.get("skill") for x in steps}]:
        raise Inconsistent(f"run.json steps: each skill once, in the order {', '.join(STEPS)}")
    named = {s["skill"]: s for s in steps}
    for skill in REQUIRED_STEPS:
        if skill not in named:
            raise Inconsistent(f"run.json steps: {skill} is required; record it as RAN, SKIPPED, or MISSING")
    for step in steps:
        where = f"run.json step {step['skill']}"
        if step.get("status") not in STEP_STATUSES:
            raise Inconsistent(f"{where}: status is RAN, SKIPPED, or MISSING")
        if step["status"] == "SKIPPED" and (step.get("skip") not in SKIPS or not text(step.get("reason"))):
            raise Inconsistent(f"{where}: a skipped step names skip ({'|'.join(SKIPS)}) and a reason")
        if step["status"] == "RAN" and step["skill"] not in ("quality-code-check", "security-performance-check") and not text(step.get("artifact")):
            raise Inconsistent(f"{where}: a step that ran names its artifact")
    checks = named["quality-code-check"].get("checks", [])
    if named["quality-code-check"]["status"] == "RAN" and (not isinstance(checks, list) or not checks or any(
            c.get("kind") not in CHECK_KINDS or not text(c.get("command")) or not isinstance(c.get("exit"), int) or isinstance(c.get("exit"), bool) for c in checks)):
        raise Inconsistent(f"run.json quality-code-check: checks list kind ({'|'.join(CHECK_KINDS)}), command, and integer exit")
    if named["quality-code-check"]["status"] == "RAN" and SURFACE_SCAN.is_file() and not any(c["kind"] == "surface" for c in checks):
        raise Inconsistent(f"run.json quality-code-check: {SURFACE_SCAN.name} is installed; run it on the change and record a surface check")
    for entry in data.get("separateTests", []):
        if entry.get("area") not in AREAS or not text(entry.get("signal")) or not text(entry.get("command")):
            raise Inconsistent(f"run.json separateTests: area ({'|'.join(AREAS)}), signal, and command")
    if any(not text(x) for x in data.get("limits", [])):
        raise Inconsistent("run.json limits must be nonempty strings")
    optional = named.get("security-performance-check")
    separate = data.get("separateTests", [])
    if optional and optional["status"] == "SKIPPED":
        skip = optional.get("skip")
        if skip == "recommended" and not separate:
            raise Inconsistent("run.json security-performance-check: skip recommended requires nonempty separateTests")
        if skip == "no-signal" and separate:
            raise Inconsistent("run.json security-performance-check: skip no-signal requires empty separateTests")
        if skip not in ("recommended", "no-signal", "no-human", "not-applicable"):
            raise Inconsistent("run.json security-performance-check: when skipped use recommended, no-signal, no-human, or not-applicable")
    return named


def check_review(data, known, items, head):
    if data.get("schema") != "validate-change/review@1" or data.get("status") not in REVIEW_STATUSES:
        raise Inconsistent(f"review.json: schema validate-change/review@1 and status one of {', '.join(REVIEW_STATUSES)}")
    if data.get("headSha") != head:
        raise Inconsistent(f"review.json reviewed {data.get('headSha')}, not the head {head}; review again")
    for key, prefix in (("findings", "PR-"), ("flows", "F"), ("suspicions", "H")):
        if not isinstance(data.get(key, []), list):
            raise Inconsistent(f"review.json {key} must be a list")
        ids_of(data.get(key, []), prefix, f"review.json {key}")
    for finding in data.get("findings", []):
        if finding.get("kind") not in ("fix", "decide"):
            raise Inconsistent(f"review.json {finding['id']}: kind is fix or decide")
        refs(finding.get("kRefs", []), known, f"review.json {finding['id']}")
    kinds = {f["kind"] for f in data.get("findings", [])}
    expected = "FAILED" if "fix" in kinds else "NEEDS_REVIEW" if "decide" in kinds else None
    if expected and REVIEW_STATUSES[data["status"]] != expected:
        raise Inconsistent(f"review.json status {data['status']} disagrees with its findings")
    if not expected and REVIEW_STATUSES[data["status"]] in ("FAILED", "NEEDS_REVIEW"):
        raise Inconsistent(f"review.json status {data['status']} has no finding behind it")
    for flow in data.get("flows", []):
        if not text(flow.get("route")) or flow.get("risk") not in ("high", "medium", "low") or not text(flow.get("why")):
            raise Inconsistent(f"review.json {flow['id']}: route, risk (high|medium|low), why")
        refs(flow.get("kRefs", []), known, f"review.json {flow['id']}")
    for suspicion in data.get("suspicions", []):
        if not text(suspicion.get("location")) or not text(suspicion.get("hypothesis")) or suspicion.get("proof") not in ("runtime", "unit", "human"):
            raise Inconsistent(f"review.json {suspicion['id']}: location, hypothesis, proof (runtime|unit|human)")
        refs(suspicion.get("kRefs", []), known, f"review.json {suspicion['id']}")
    for note in data.get("preflight", []):
        if note.get("kind") not in ("migration", "flag", "env", "seed") or not text(note.get("detail")):
            raise Inconsistent("review.json preflight: kind (migration|flag|env|seed) and detail")
    asked = set()
    for question in data.get("questions", []):
        if question.get("kRef") not in known or not text(question.get("question")):
            raise Inconsistent("review.json questions: kRef to a known item and the question")
        asked.add(question["kRef"])
    unasked = sorted(i["id"] for i in items if i["source"] == "agent-intent" and i["confirmed"] == "none" and i["id"] not in asked)
    if unasked:
        raise Inconsistent(f"review.json: unconfirmed agent-intent items need a human question: {', '.join(unasked)}")


def check_audit(data, known, bundle):
    if data.get("schema") != "validate-change/audit@1" or not isinstance(data.get("verdicts"), list):
        raise Inconsistent("audit.json: schema validate-change/audit@1 with verdicts")
    named = [v.get("k") for v in data["verdicts"]]
    if sorted(named) != sorted(known):
        raise Inconsistent("audit.json: one verdict for every expectation item")
    for verdict in data["verdicts"]:
        where = f"audit.json {verdict['k']}"
        if verdict.get("verdict") not in VERDICTS or not text(verdict.get("reason")) or not isinstance(verdict.get("evidence"), list):
            raise Inconsistent(f"{where}: verdict ({'|'.join(VERDICTS)}), reason, evidence list")
        if verdict["verdict"] in ("SUPPORTED", "CONTRADICTED") and not verdict["evidence"]:
            raise Inconsistent(f"{where}: {verdict['verdict']} cites the evidence it rests on")
        for entry in verdict["evidence"]:
            target = (bundle / str(entry.get("file", ""))).resolve() if bundle else None
            if not bundle or not text(entry.get("file")) or not text(entry.get("locator")) or bundle.resolve() not in target.parents or not target.is_file():
                raise Inconsistent(f"{where}: evidence names a file inside the runtime bundle and a locator")
    return {v["k"]: v for v in data["verdicts"]}


# ---------- runtime ----------

def runtime_status(bundle, known, confirmed, review, head):
    """Verify the bundle with the runtime tool, then map its cases to expectations, flows, and suspicions."""
    if not EVIDENCE.is_file():
        raise Inconsistent(f"runtime-e2e-test is not installed beside this skill ({EVIDENCE}); its bundle cannot be verified")
    audited = subprocess.run([sys.executable, str(EVIDENCE), "audit", str(bundle)], capture_output=True, text=True)
    if audited.returncode not in (0, 1):
        raise Inconsistent(f"runtime bundle {bundle} does not audit: {(audited.stderr or audited.stdout).strip()[-300:]}")
    manifest, results = load(bundle / "run-manifest.json"), load(bundle / "results.json")
    # Light tests are written into the project, so a dirty tree is expected; the commit must still match.
    if manifest.get("gitHead") != head:
        raise Inconsistent(f"runtime bundle ran on {manifest.get('gitHead')}, not the reviewed head {head}; run it again")
    suite = load(bundle / "inputs" / manifest["suite"])
    # Without a review there is no handoff to check flow and suspicion references against.
    flows = {f["id"] for f in review.get("flows", [])} if review else None
    suspicions = {s["id"] for s in review.get("suspicions", [])} if review else None
    rows = {r["caseId"]: r for r in results["cases"]}
    cases = []
    for case in suite["cases"]:
        where = f"suite case {case['id']}"
        cases.append({"id": case["id"], "result": rows[case["id"]]["result"], "proof": rows[case["id"]]["proof"],
                      "expects": refs(case.get("expects", []), known, where),
                      "flows": refs(case.get("flows", []), flows, where) if review else [],
                      "suspicions": refs(case.get("suspicions", []), suspicions, where) if review else []})
    failed = [c["id"] for c in cases if c["result"] == "FAIL"] + [s["id"] for s in (results.get("existing") or {}).get("suites", []) if s["status"] == "NEW_FAILURE"]
    blocked = [c["id"] for c in cases if c["result"] == "BLOCKED"]
    line = next((l for l in audited.stdout.splitlines() if l.startswith("Audit:")), "Audit: no line")
    notes = intent_sweep_notes(line, results, cases, suite, confirmed) if audited.returncode == 1 else []
    status = "FAILED" if failed else "BLOCKED" if blocked else "NEEDS_REVIEW" if audited.returncode and not notes else "PASSED"
    return {"status": status, "audit": line, "cases": cases, "failed": failed, "blocked": blocked, "notes": notes}


def intent_sweep_notes(line, results, cases, suite, confirmed):
    """Notes for sweep differences when they are the audit's only open item, add no console error, and each sits on
    a route that a passing, proving case for a human-confirmed expectation covers; otherwise [] and the run stays
    NEEDS_REVIEW. Route coverage does not prove every pixel of the page, so the note keeps both screenshots."""
    problems = line.removeprefix("Audit: evidence consistent; ").split("; ")
    if len(problems) != 1 or not problems[0].startswith("sweep differences needing review: "):
        return []
    passing = {c["id"] for c in cases if c["result"] == "PASS" and c["proof"] != "NON_PROVING" and set(c["expects"]) & confirmed}
    proving = {}
    for case in suite["cases"]:
        if case["id"] in passing:
            for route in case.get("routes", []):
                proving.setdefault(route, []).append(case["id"])
    differing = [r for r in (results.get("sweep") or {}).get("routes", []) if r["differs"]]
    if not differing or any(r["route"] not in proving or "consoleErrors" in r["differs"] for r in differing):
        return []
    return [f"Sweep khác base ở `{r['route']}` ({', '.join(r['differs'])}); trang này có case pass cho kỳ vọng đã xác nhận "
            f"({', '.join(proving[r['route']])}). Xem ảnh base `{r['screenshots']['base']}` và head `{r['screenshots']['head']}`."
            for r in differing]


def coverage(item, cases):
    mapped = [c for c in cases if item in c["expects"]]
    good = [c for c in mapped if c["result"] == "PASS" and c["proof"] != "NON_PROVING"]
    # A failing case already fails the run, so the expectation is reported as failed, not as unproven.
    if any(c["result"] == "FAIL" for c in mapped):
        return "FAILED", [c["id"] for c in mapped]
    return ("FULL" if mapped and len(good) == len(mapped) else "PARTIAL" if good else "NONE"), [c["id"] for c in mapped]


# ---------- report ----------

def evaluate(root, run_dir, rules_path):
    expectations = load(run_dir / "expectations.json")
    known = check_expectations(expectations)
    items = expectations["items"]
    risk = load(run_dir / "risk.json")
    head = git(root, "rev-parse", "HEAD").strip()
    if risk.get("headSha") != head:
        raise Inconsistent(f"risk.json was computed for {risk.get('headSha')}, but HEAD is {head}; run risk again")
    # Light tests written after the risk step are untracked too, so only the files recorded then are compared.
    fresh = assess(root, risk["base"], risk["worktree"], expectations, rules_path, risk.get("untracked", []))
    rules = load_rules(rules_path)[1]
    intent_ids = {r["id"] for r in rules if r["scope"] == "builtin" and r["check"] in INTENT_BUILTINS}
    diff_only = lambda r: [s for s in r["signals"] if s["rule"] not in intent_ids]
    if (fresh["rulesDigest"], fresh["baseSha"], diff_only(fresh), fresh.get("separateTests", [])) != (
            risk["rulesDigest"], risk["baseSha"], diff_only(risk), risk.get("separateTests", [])):
        raise Inconsistent("risk.json does not match the diff, the risk rules, or the installed signal files; run risk again instead of editing it")
    # Expectations edited after the risk step can add an intent signal, never remove the stored one.
    added = [s for s in intent_signals(expectations, rules) if s["rule"] not in {x["rule"] for x in risk["signals"]}]
    risk = {**risk, "signals": risk["signals"] + added,
            "separateTests": risk.get("separateTests", []),
            "gate": "required" if risk["gate"] == "required" or any(s["level"] in ("high", "gate") for s in added) else risk["gate"],
            "audit": "required" if risk["audit"] == "required" or any(s["level"] == "high" for s in added) else risk["audit"]}
    run = load(run_dir / "run.json")
    steps = check_run(run)
    if spc_installed() and steps.get("security-performance-check", {}).get("status", "MISSING") == "MISSING":
        raise Inconsistent("run.json security-performance-check: the skill is installed, so record it as SKIPPED (recommended or no-signal) or RAN, never MISSING")
    # Signal-file matches from the risk step must reach the report; the command may carry the target label.
    listed = run.get("separateTests", [])
    dropped = [e for e in risk["separateTests"] if not any(
        x["area"] == e["area"] and x["signal"] == e["signal"] and (x["command"] == e["command"] or x["command"].startswith(e["command"] + " "))
        for x in listed)]
    if dropped:
        raise Inconsistent("run.json separateTests omits signal-file matches from risk.json: "
                           + ", ".join(f"{e['area']}: {e['signal']}" for e in dropped) + "; copy them from risk.json")
    sections, limits = [], list(run.get("limits", []))

    gate = run["gate"]
    required = risk["gate"] == "required" or gate["override"] == "always"
    if required and gate["override"] == "never":
        mode = "WAIVED"
    elif required and gate["answer"] is None:
        raise Inconsistent("The risk rule requires the gate, but run.json records no answer; ask the human once, or end with answer no-human")
    elif required:
        mode = "NEEDS_HUMAN" if gate["answer"] == "no-human" else "CONFIRMED"
    else:
        if gate["answer"] is not None:
            raise Inconsistent("The gate was not required, so run.json records no gate answer")
        mode = "STRAIGHT-THROUGH"
    unconfirmed = [i["id"] for i in items if i["confirmed"] == "none"]
    if mode == "CONFIRMED" and unconfirmed:
        raise Inconsistent(f"The human confirmed the list at the gate; mark {', '.join(unconfirmed)} confirmed: gate")
    if mode != "CONFIRMED" and any(i["confirmed"] == "gate" for i in items):
        raise Inconsistent("Items are marked confirmed at the gate, but no gate answer confirms them")
    if mode == "NEEDS_HUMAN":
        ran = [s for s in REQUIRED_STEPS if steps[s]["status"] != "SKIPPED" or steps[s].get("skip") != "no-human"]
        if ran:
            raise Inconsistent(f"With no human at a required gate the run stops; record {', '.join(ran)} as SKIPPED with skip no-human")
        sections.append(("NEEDS_HUMAN", "gate cần human xác nhận, nhưng không có human trả lời"))
    if mode == "WAIVED":
        limits.append("Human bỏ qua gate (--gate=never); mức rủi ro tính được vẫn giữ nguyên trong báo cáo.")
    human = [i for i in items if i["confirmed"] != "none"]
    if not human:
        sections.append(("NEEDS_REVIEW", "ý định chưa được human xác nhận"))
    open_conflicts = [c["id"] for c in expectations.get("conflicts", []) if c["resolution"] == "unresolved"]
    if open_conflicts:
        sections.append(("NEEDS_REVIEW", f"xung đột chưa giải quyết: {', '.join(open_conflicts)}"))

    for skill in REQUIRED_STEPS:
        if steps[skill]["status"] == "MISSING":
            sections.append(("BLOCKED", f"thiếu skill bắt buộc {skill}"))
            limits.append(f"{skill} chưa được cài nên bước này không chạy.")
        elif steps[skill]["status"] == "SKIPPED" and steps[skill]["skip"] == "not-applicable":
            # A step that did not run proves nothing, so the change cannot pass on the other steps alone.
            sections.append(("NEEDS_REVIEW", f"{skill} không chạy: {steps[skill]['reason']}"))

    static = steps["quality-code-check"]
    build_failed = static["status"] == "RAN" and any(c["kind"] == "build" and c["exit"] != 0 for c in static["checks"])
    if build_failed:
        sections.append(("FAILED", "build lỗi"))
        runtime_step = steps["runtime-e2e-test"]
        if runtime_step["status"] != "SKIPPED" or runtime_step.get("skip") != "build-failed":
            raise Inconsistent("The build failed, so runtime-e2e-test is SKIPPED with skip build-failed")
    elif static["status"] == "RAN":
        failing = sorted({c["kind"] for c in static["checks"] if c["exit"] != 0})
        if failing:
            sections.append(("FAILED", f"kiểm tra tĩnh lỗi: {', '.join(failing)}"))
    if steps["runtime-e2e-test"].get("skip") == "build-failed" and not build_failed:
        raise Inconsistent("runtime-e2e-test is skipped for a failed build, but no build check failed")

    review = None
    if steps["review-pr"]["status"] == "RAN":
        review = load(root / steps["review-pr"]["artifact"])
        check_review(review, known, items, head)
        status = REVIEW_STATUSES[review["status"]]
        if status != "PASSED":
            sections.append((status, f"review-pr: {review['status']}"))

    runtime, bundle = None, None
    if steps["runtime-e2e-test"]["status"] == "RAN":
        bundle = root / steps["runtime-e2e-test"]["artifact"]
        runtime = runtime_status(bundle, known, {i["id"] for i in items if i["confirmed"] != "none"}, review, head)
        if runtime["status"] != "PASSED":
            sections.append((runtime["status"], f"runtime-e2e-test: {runtime['audit']}"))
    covered = {i["id"]: coverage(i["id"], runtime["cases"]) if runtime else ("NOT_RUN", []) for i in items}
    thin = [k for k, (level, _) in covered.items() if level in ("NONE", "PARTIAL")]
    if runtime:
        # FULL counts passing cases; for an added or modified behavior it does not say a case could fail without the change.
        unproven = [i["id"] for i in items if i["change"] in ("added", "modified") and covered[i["id"]][0] == "FULL"
                    and not any(c["proof"] == "PROVEN" for c in runtime["cases"] if i["id"] in c["expects"])]
        if unproven:
            limits.append(f"{', '.join(unproven)}: coverage FULL chỉ nghĩa là case pass; chưa case nào chứng minh được là sẽ fail nếu thiếu thay đổi (can-fail chưa PROVEN).")
    if runtime and thin:
        sections.append(("NEEDS_REVIEW", f"kỳ vọng chưa được chứng minh đủ ở runtime: {', '.join(thin)}"))

    audit_step = steps.get("audit")
    verdicts = {}
    if audit_step and audit_step["status"] == "RAN":
        verdicts = check_audit(load(root / audit_step["artifact"]), known, bundle)
        contradicted = [k for k, v in verdicts.items() if v["verdict"] == "CONTRADICTED"]
        weak = [k for k, v in verdicts.items() if v["verdict"] in ("UNSUPPORTED", "MISSING")]
        if contradicted:
            sections.append(("FAILED", f"audit: evidence ngược với kỳ vọng {', '.join(contradicted)}"))
        if weak:
            sections.append(("NEEDS_REVIEW", f"audit: chưa đủ evidence cho {', '.join(weak)}"))
    elif risk["audit"] == "required" and mode != "NEEDS_HUMAN":
        sections.append(("NEEDS_REVIEW", "change rủi ro cao nhưng audit độc lập chưa chạy"))
        limits.append("Audit độc lập bắt buộc cho change rủi ro cao nhưng chưa chạy.")

    optional = steps.get("security-performance-check")
    if (
        not optional
        or optional["status"] == "MISSING"
        or (optional["status"] == "SKIPPED" and optional.get("skip") in ("no-human", "not-applicable"))
    ):
        limits.append("security-performance-check chưa được cài hoặc chưa chạy; các mục `Cần test riêng` chỉ là tín hiệu cần human quyết định.")
    elif optional["status"] == "SKIPPED" and optional.get("skip") == "recommended":
        limits.append("security-performance-check đã cài nhưng chưa chạy; các mục `Cần test riêng` khuyến nghị human quyết định có chạy `/security-performance-check` hay không.")
    elif optional["status"] == "SKIPPED" and optional.get("skip") == "no-signal":
        limits.append("security-performance-check đã cài; không có tín hiệu `Cần test riêng` trên change này.")

    overall = next(s for s in ORDER if s == "PASSED" or any(level == s for level, _ in sections))
    return {"expectations": expectations, "risk": risk, "run": run, "steps": steps, "mode": mode, "review": review, "runtime": runtime,
            "covered": covered, "verdicts": verdicts, "sections": sections, "limits": limits, "overall": overall, "humanIntent": bool(human)}


def markdown(state):
    risk, run = state["risk"], state["run"]
    signals = "; ".join(f"{s['rule']} ({s['level']}): {s['hits'][0]}" + (f" +{s['count'] - 1}" if s["count"] > 1 else "") for s in risk["signals"]) or "không có tín hiệu"
    lines = [f"# Validate change — {run['target']['label']}", ""]
    if not state["humanIntent"]:
        lines += ["**Ý định chưa được human xác nhận.**", ""]
    lines += [
        f"- Trạng thái: **{state['overall']}** — {LABELS[state['overall']]}.",
        f"- Lý do: {'; '.join(f'{text} ({level})' for level, text in state['sections']) or 'mọi phần đều đạt trong phạm vi đã kiểm'}.",
        f"- Gate: {state['mode']}; rủi ro: {signals}.",
        f"- Audit độc lập: {'đã chạy' if state['verdicts'] else 'bắt buộc' if risk['audit'] == 'required' else 'không bắt buộc'}.",
        f"- So sánh: `{risk['baseSha'][:12]}` → `{risk['headSha'][:12]}`{' (working tree)' if risk['worktree'] else ''}; {risk['files']} file, {risk['lines']} dòng thay đổi.",
        "",
        "## Các bước",
        "",
        "| Skill | Trạng thái | Ghi chú |",
        "| --- | --- | --- |",
    ]
    for skill, step in state["steps"].items():
        note = step.get("artifact") or step.get("reason") or ""
        if skill == "quality-code-check" and step["status"] == "RAN":
            note = ", ".join(f"{c['kind']} exit {c['exit']}" for c in step["checks"])
        lines.append(f"| {skill} | {step['status']}{' (' + step['skip'] + ')' if step.get('skip') else ''} | {note} |")
    lines += ["", "## Kỳ vọng", "", "| K | Thay đổi | Nguồn | Xác nhận | Case | Coverage | Audit |", "| --- | --- | --- | --- | --- | --- | --- |"]
    for item in state["expectations"]["items"]:
        level, cases = state["covered"][item["id"]]
        verdict = state["verdicts"].get(item["id"], {}).get("verdict", "—")
        lines.append(f"| {item['id']}: {item['statement']} | {item['change']} | {item['source']} (`{item['sourceRef']}`) | {item['confirmed']} | {', '.join(cases) or '—'} | {level} | {verdict} |")
    assumptions = [i for i in state["expectations"]["items"] if i["source"] == "assumption"]
    if assumptions:
        lines += ["", "Giả định đã chọn:"] + [f"- {i['id']}: {i['default']}" for i in assumptions]
    conflicts = state["expectations"].get("conflicts", [])
    if conflicts:
        lines += ["", "## Xung đột", ""] + [f"- {c['id']} ({', '.join(c['items'])}): {c['summary']} — {'chưa giải quyết' if c['resolution'] == 'unresolved' else 'human chọn ' + c['resolution']}" for c in conflicts]
    review, runtime = state["review"], state["runtime"]
    if review:
        tested = lambda key, ident: runtime and any(ident in c[key] for c in runtime["cases"])
        lines += ["", "## Handoff từ review", ""]
        lines += [f"- {f['id']} `{f['route']}` ({f['risk']}): {f['why']} — {'có case' if tested('flows', f['id']) else 'chưa có case'}" for f in review.get("flows", [])]
        lines += [f"- {s['id']} `{s['location']}`: {s['hypothesis']} — kiểm bằng {s['proof']}; {'có case' if tested('suspicions', s['id']) else 'chưa có case'}" for s in review.get("suspicions", [])]
        lines += [f"- Chuẩn bị ({p['kind']}): {p['detail']}" for p in review.get("preflight", [])]
        lines += [f"- Câu hỏi cho human ({q['kRef']}): {q['question']}" for q in review.get("questions", [])]
    if runtime:
        lines += ["", "## Runtime", "", f"- {runtime['audit']}"]
        lines += [f"- Ghi chú: {n}" for n in runtime["notes"]]
        lines += [f"- {c['id']}: {c['result']}, can-fail {c['proof']}" for c in runtime["cases"]]
    lines += ["", "## Cần test riêng", ""]
    lines += [f"- {e['area']}: {e['signal']}{' (evidence: `' + e['evidence'] + '`)' if e.get('evidence') else ''}. Lệnh: `{e['command']}`" for e in run.get("separateTests", [])] or ["- Không có tín hiệu."]
    lines += ["", "Các mục này là tín hiệu để human quyết định có test riêng hay không, không phải lỗi, và không ảnh hưởng trạng thái tổng."]
    lines += ["", "## Giới hạn", ""] + ([f"- {x}" for x in state["limits"]] or ["- Không có."])
    return "\n".join(lines) + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    risk = sub.add_parser("risk", help="compute the risk signals, the gate, and the audit requirement into risk.json")
    risk.add_argument("run_dir")
    risk.add_argument("--base", required=True, help="base ref; the change is base...HEAD, or base..working tree with --worktree")
    risk.add_argument("--worktree", action="store_true", help="include uncommitted changes")
    for name in ("audit-input", "report"):
        sub.add_parser(name).add_argument("run_dir")
    for command in sub.choices.values():
        command.add_argument("--rules", default=str(RULES))
    args = parser.parse_args(argv)
    run_dir = Path(args.run_dir)
    try:
        root = Path(git(Path.cwd(), "rev-parse", "--show-toplevel").strip())
        expectations = load(run_dir / "expectations.json")
        check_expectations(expectations)
        if args.command == "risk":
            result = assess(root, args.base, args.worktree, expectations, args.rules)
            write(run_dir / "risk.json", result)
            separate = ", ".join(f"{e['area']}:{e['signal'].split(':', 1)[0]}" for e in result["separateTests"]) or "none"
            print(f"Gate: {result['gate']}; audit: {result['audit']}; signals: {', '.join(s['rule'] for s in result['signals']) or 'none'}; separateTests: {separate}")
            return 0
        if args.command == "audit-input":
            risk_data = load(run_dir / "risk.json")
            order = [{"id": i["id"], "statement": i["statement"]} for i in expectations["items"]]
            # Shuffled against position bias, seeded by the head so a rerun gives the auditor the same order.
            random.Random(risk_data["headSha"]).shuffle(order)
            write(run_dir / "audit-input.json", {"schema": "validate-change/audit-input@1", "expectations": order})
            print(f"Wrote {run_dir / 'audit-input.json'}")
            return 0
        state = evaluate(root, run_dir, args.rules)
    except Inconsistent as error:
        print(f"Inconsistent: {error}", file=sys.stderr)
        return 2
    except (KeyError, TypeError, AttributeError, IndexError) as error:
        print(f"Inconsistent: a run file is malformed ({type(error).__name__}: {error})", file=sys.stderr)
        return 2
    report = markdown(state)
    (run_dir / "report.md").write_text(report, encoding="utf-8")
    write(run_dir / "status.json", {"overall": state["overall"], "gate": state["mode"], "sections": [{"status": s, "reason": r} for s, r in state["sections"]], "limits": state["limits"]})
    print(report)
    return 0 if state["overall"] == "PASSED" else 1


if __name__ == "__main__":
    sys.exit(main())
