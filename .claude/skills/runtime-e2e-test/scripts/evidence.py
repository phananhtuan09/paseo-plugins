#!/usr/bin/env python3
"""Snapshot approved inputs, run native Playwright, and audit evidence bundles."""
import argparse
import base64
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import uuid
import xml.etree.ElementTree as ET
import zlib
from datetime import datetime, timezone
from pathlib import Path

# Importing the sibling impact module must not leave __pycache__ in the installed skill directory.
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import impact  # noqa: E402

KINDS = {"browser", "api", "pr-test", "sweep"}
CLASSIFICATIONS = {"new-behavior", "invariant"}
MODES = {"durable", "light"}
CATALOG = Path(__file__).resolve().parents[1] / "references" / "blind-spots.md"
LOCAL_HOSTS = re.compile(r"(localhost|127(\.\d+){3}|0\.0\.0\.0|\[?::1\]?|host\.docker\.internal|[\w.-]+\.(localhost|local|test|internal))$")
# Hosts named for a shared non-production stage, or on a private network: recorded, not stopped.
SHARED_HOSTS = re.compile(r"(^|[.-])(staging|stage|dev|develop|test|qa|uat|sandbox|preview)([.-]|$)|^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\.")
URL_USES = re.compile(r"""(?:baseURL\s*[:=]\s*|\.goto\(\s*|\.(?:get|post|put|patch|delete|fetch|newContext)\(\s*|=\s*)['"`](https?://[^'"`\s]+)""")
SECRET_VALUES = re.compile(r"(sk_live_[0-9A-Za-z]{8,}|AKIA[0-9A-Z]{16}|gh[pousr]_[0-9A-Za-z]{30,}|xox[abprs]-[0-9A-Za-z-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)")
SECRET_NAMES = re.compile(r"(TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE_KEY|ACCESS_KEY|CREDENTIAL)", re.I)
SETUP_TIMEOUT = 1800
SUITE_EXIT = "(suite exit code)"
# Rendering jitter moves channels by a few units between two identical pages; real changes move them far more.
PIXEL_TOLERANCE = 16


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def local(root, name):
    path = (root / name).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError(f"Path outside root: {name}")
    return path


def command_dir(root, data):
    """The directory the approved command runs in: `cwd` (relative to the root) or the root itself."""
    name = data.get("cwd", ".")
    if not isinstance(name, str) or not name.strip() or Path(name).is_absolute():
        raise ValueError("cwd must be a directory path relative to the root")
    path = local(root, name)
    if not path.is_dir():
        raise ValueError(f"cwd is not a directory: {name}")
    return path


def contract(suite, root):
    data = load(suite)
    for key in ("plan", "environment", "revision"):
        if not isinstance(data.get(key), str) or not data[key].strip():
            raise ValueError(f"Missing {key}")
    command = data.get("command")
    if not isinstance(command, list) or not command or any(not isinstance(x, str) or not x for x in command):
        raise ValueError("command must be a nonempty argument array")
    if any(x.startswith(("--output", "--reporter")) for x in command):
        raise ValueError("Runner owns --output and --reporter")
    command_dir(root, data)
    base = data.get("base")
    if base is not None:
        if not isinstance(base, dict) or not isinstance(base.get("revision"), str) or not base["revision"].strip():
            raise ValueError("base needs a revision")
        env = base.get("env")
        if not isinstance(env, dict) or not env or any(not isinstance(k, str) or not isinstance(v, str) for k, v in env.items()):
            raise ValueError("base env must give the base instance its own ports and data")
        for step in base.get("setup", []):
            if not isinstance(step, list) or not step or any(not isinstance(x, str) or not x for x in step):
                raise ValueError("base setup steps must be nonempty argument arrays")
        if not isinstance(base.get("keep", []), list) or set(base.get("keep", [])) - set(data.get("files") or []):
            raise ValueError("base keep must list approved files")
    det = data.get("determinism")
    if det is not None:
        if not isinstance(det, dict) or set(det) - {"env", "normalize", "limits"}:
            raise ValueError("determinism takes only env, normalize, and limits")
        env = det.get("env", {})
        if not isinstance(env, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in env.items()):
            raise ValueError("determinism env must map names to string values")
        if base is not None and set(env) & set(base["env"]):
            raise ValueError("base env must not override determinism env")
        rules = det.get("normalize", [])
        if not isinstance(rules, list) or any(not isinstance(r, dict) or set(r) != {"pattern", "replacement"} or not isinstance(r["pattern"], str) or not r["pattern"] or not isinstance(r["replacement"], str) for r in rules):
            raise ValueError("determinism normalize rules need a pattern and a replacement")
        for rule in rules:
            try:
                # sub() parses the replacement template even without a match, so bad group references fail here.
                re.compile(rule["pattern"]).sub(rule["replacement"], "")
            except (re.error, IndexError) as error:
                raise ValueError(f"Invalid normalize rule {rule['pattern']!r} -> {rule['replacement']!r}: {error}") from None
        limits = det.get("limits", [])
        if not isinstance(limits, list) or any(not isinstance(x, str) or not x.strip() for x in limits):
            raise ValueError("determinism limits must be nonempty strings")
    if "mode" in data:
        if data["mode"] not in MODES or not isinstance(data.get("modeReason"), str) or not data["modeReason"].strip():
            raise ValueError("mode is durable or light, with modeReason naming the signal that chose it")
    if data.get("mode") == "light":
        # Resolved first, so a path such as x/../docs/testing/... cannot slip past the check.
        for path in (suite.resolve(), local(root, data["plan"])):
            if path.relative_to(root.resolve()).parts[:2] == ("docs", "testing"):
                raise ValueError("A light suite and its plan live outside docs/testing; promote the run to keep them")
    existing_contract(data)
    keys = set()
    if data.get("regression") is not None:
        if base is None:
            raise ValueError("regression needs a base: the impact map is the change between base and head")
        keys = {r["route"] for r in impact.config_of(data["regression"])["routes"]}
    cases = data.get("cases", [])
    ids = [c["id"] for c in cases]
    if not ids or len(ids) != len(set(ids)):
        raise ValueError("Cases must have unique IDs")
    if all(c.get("kind") in ("pr-test", "sweep") for c in cases):
        raise ValueError("A suite needs at least one runtime case besides pr-test and sweep cases")
    for case in cases:
        if not re.fullmatch(r"[A-Za-z0-9_.-]+", case["id"]) or case.get("kind") not in KINDS:
            raise ValueError("Invalid case ID/kind")
        if case.get("classification", "new-behavior") not in CLASSIFICATIONS:
            raise ValueError("classification must be new-behavior or invariant")
        routes = case.get("routes", [])
        if not isinstance(routes, list) or any(not isinstance(r, str) for r in routes) or set(routes) - keys:
            raise ValueError("case routes must name key routes from the regression block")
        if case["kind"] == "sweep":
            if not routes or "checks" in case:
                raise ValueError("A sweep case lists the key routes it captures and has no checks")
            continue
        if case["kind"] == "pr-test":
            test = case.get("test", {})
            if not isinstance(test, dict) or any(not isinstance(test.get(k), str) or not test[k] for k in ("file", "title")):
                raise ValueError("pr-test cases need test.file and test.title")
            if test["file"] not in (data.get("files") or []):
                raise ValueError("pr-test files must be listed in files")
            continue
        checks = case.get("checks", [])
        if not checks or len({c["id"] for c in checks}) != len(checks):
            raise ValueError("Each case needs uniquely mapped checks")
        for check in checks:
            if any(not check.get(k) for k in ("id", "expected", "source")):
                raise ValueError("Checks need id, expected, source")
    blind_spots_contract(data.get("blindSpots"), ids, catalog())
    files = data.get("files", [])
    if not isinstance(files, list) or not files:
        raise ValueError("List test/config/helper files in files")
    names = list(dict.fromkeys([str(suite.resolve().relative_to(root)), data["plan"], *files]))
    hashes = {name: digest(local(root, name)) for name in names}
    plan = local(root, data["plan"]).read_text(encoding="utf-8")
    plan_ids = re.findall(r"^## Case ([A-Za-z0-9_.-]+)\s+[—-]\s+", plan, re.M)
    if sorted(ids) != sorted(plan_ids):
        raise ValueError("Suite cases must exactly match Markdown cases")
    validator = Path(__file__).resolve().parents[1] / "validate_test_plan.py"
    checked = subprocess.run([sys.executable, str(validator), str(local(root, data["plan"]))], capture_output=True, text=True)
    if checked.returncode:
        raise ValueError(checked.stderr or checked.stdout)
    return data, hashes


def catalog(path=CATALOG):
    """Item IDs of the installed blind-spot catalog, or None when the project has removed the file."""
    if not path.is_file():
        return None
    return re.findall(r"^\|\s*`([A-Za-z0-9_.-]+)`\s*\|", path.read_text(encoding="utf-8"), re.M)


def blind_spots_contract(entries, ids, items):
    """Each catalog item is applied by cases, skipped with a reason, or left to the human as a question."""
    if items is None:
        if entries is not None:
            raise ValueError("blindSpots needs the blind-spot catalog, which is not installed")
        return
    if not isinstance(entries, list) or any(not isinstance(e, dict) for e in entries):
        raise ValueError(f"Declare blindSpots: every item of {CATALOG.name}, applied, skipped, or asked")
    for entry in entries:
        if not isinstance(entry.get("item"), str):
            raise ValueError("Each blindSpots entry names its catalog item as a string")
        outcome = set(entry) & {"cases", "skipped", "question"}
        if set(entry) - {"item", "cases", "skipped", "question"} or len(outcome - {"cases"} if "question" in entry else outcome) != 1:
            raise ValueError("Each blindSpots entry has item and one of cases, skipped, or question (a question may name cases)")
        cases = entry.get("cases", [])
        if "cases" in entry and (not isinstance(cases, list) or not cases or any(not isinstance(c, str) for c in cases) or set(cases) - set(ids)):
            raise ValueError(f"blindSpots {entry.get('item')}: cases must name suite cases")
        for key in ("skipped", "question"):
            if key in entry and (not isinstance(entry[key], str) or not entry[key].strip()):
                raise ValueError(f"blindSpots {entry.get('item')}: {key} needs text")
    named = [e.get("item") for e in entries]
    if len(named) != len(set(named)) or set(named) != set(items):
        missing, unknown = sorted(set(items) - set(named)), sorted(set(named) - set(items))
        raise ValueError(f"blindSpots must name each catalog item once; missing: {', '.join(missing) or 'none'}; not in the catalog or repeated: {', '.join(unknown) or 'repeated'}")


def environment_check(root, data):
    """Production-like targets and real-looking credentials in the suite's env and files: strong signals stop a light run."""
    strong, weak = [], []
    envs = [("determinism env", (data.get("determinism") or {}).get("env", {})), ("base env", (data.get("base") or {}).get("env", {}))]
    envs += [(f"existing suite {e['id']} env", e.get("env", {})) for e in (data.get("existing") or {}).get("suites", [])]
    texts = [(f"{label} {key}", value) for label, env in envs for key, value in env.items()]
    for name in data["files"]:
        path = local(root, name)
        if path.suffix in (".ts", ".js", ".mjs", ".cjs", ".tsx", ".jsx", ".json", ".env") or "config" in path.name:
            texts.append((name, path.read_text(encoding="utf-8", errors="replace")))
    for where, text in texts:
        if SECRET_VALUES.search(text):
            strong.append(f"{where}: a real-looking credential")
        urls = [text] if re.fullmatch(r"https?://\S+", text) else URL_USES.findall(text)
        for url in urls:
            # The host ends at a port, path, or template placeholder, as in `http://localhost:${port}`.
            host = re.match(r"https?://(?:[^@/?#]*@)?(\[[^\]]*\]|[^:/?#$`{}]*)", url)[1].lower()
            if not host:
                weak.append(f"{where}: host built at runtime in {url[:60]}")
            elif LOCAL_HOSTS.fullmatch(host):
                continue
            else:
                (weak if SHARED_HOSTS.search(host) else strong).append(f"{where}: {'shared' if SHARED_HOSTS.search(host) else 'production-like'} host {host}")
    for label, env in envs:
        weak += [f"{label} {key}: credential-named variable with a value" for key, value in env.items()
                 if SECRET_NAMES.search(key) and value.strip() and not SECRET_VALUES.search(value)]
    return {"strong": sorted(set(strong)), "weak": sorted(set(weak))}


def existing_contract(data):
    """The project's own test suites, run on base and head so new failures are told apart from old ones."""
    existing = data.get("existing")
    if existing is None:
        if data.get("base") is not None:
            raise ValueError("A suite with a base must declare existing: the project's own test suites, or none with a reason")
        return
    if not isinstance(existing, dict) or set(existing) - {"suites", "reason"}:
        raise ValueError("existing takes only suites and reason")
    suites = existing.get("suites", [])
    if not isinstance(suites, list):
        raise ValueError("existing suites must be a list")
    if not suites and (not isinstance(existing.get("reason"), str) or not existing["reason"].strip()):
        raise ValueError("existing needs suites, or a reason why the project has none")
    for entry in suites:
        if not isinstance(entry, dict) or set(entry) - {"id", "command", "env"}:
            raise ValueError("Each existing suite takes only id, command, and env")
        if not isinstance(entry.get("id"), str) or not re.fullmatch(r"[A-Za-z0-9_.-]+", entry["id"]):
            raise ValueError("Each existing suite needs an ID")
        command = entry.get("command")
        if not isinstance(command, list) or not command or any(not isinstance(x, str) or not x for x in command):
            raise ValueError("existing suite command must be a nonempty argument array")
        env = entry.get("env", {})
        if not isinstance(env, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in env.items()):
            raise ValueError("existing suite env must map names to string values")
    ids = [entry["id"] for entry in suites]
    if len(ids) != len(set(ids)):
        raise ValueError("Existing suite IDs must be unique")


def run_existing(run, cwd, entry, extra_env, label):
    """Run one of the project's own suites; {report} in its command or env names the JUnit file it writes."""
    folder = run / "existing" / entry["id"]
    folder.mkdir(parents=True, exist_ok=True)
    report = folder / f"{label}.xml"
    fill = lambda value: value.replace("{report}", str(report))
    env = {**os.environ, **extra_env, **{k: fill(v) for k, v in entry.get("env", {}).items()}}
    uses_report = any("{report}" in x for x in [*entry["command"], *entry.get("env", {}).values()])
    with (folder / f"{label}.log").open("w", encoding="utf-8") as log:
        try:
            # Existing suite commands are human-approved argument arrays (hashed with the suite) and run without a shell.
            done = subprocess.run([fill(x) for x in entry["command"]], cwd=cwd, env=env, capture_output=True, text=True, timeout=SETUP_TIMEOUT)  # nosemgrep: python.lang.security.audit.dangerous-subprocess-use-audit
            code, output = done.returncode, done.stdout + done.stderr
        except subprocess.TimeoutExpired:
            code, output = 124, f"timed out after {SETUP_TIMEOUT}s"
        except OSError as error:
            code, output = 127, str(error)
        log.write(output)
    return {"command": entry["command"], "exitCode": code, "report": uses_report}


def junit(path):
    """Map each test in a JUnit XML report to (file, title, outcome); None when the report is missing or unreadable."""
    try:
        tree = ET.parse(path)
    except (OSError, ET.ParseError):
        return None
    tests, seen = {}, {}
    for case in tree.iter("testcase"):
        name = f"{case.get('classname', '')} > {case.get('name', '')}"
        # The same title can run more than once, e.g. once per browser project.
        seen[name] = seen.get(name, 0) + 1
        key = name if seen[name] == 1 else f"{name} #{seen[name]}"
        if case.find("failure") is not None or case.find("error") is not None:
            outcome = "failed"
        elif case.find("skipped") is not None:
            outcome = "skipped"
        else:
            outcome = "passed"
        tests[key] = (case.get("classname", ""), case.get("name", ""), outcome)
    return tests


def existing_tests(run, suite_id, label, record, own):
    """Test outcomes of one execution, without the plan's own cases; None when they cannot be read."""
    tests = {}
    if record["report"]:
        parsed = junit(run / "existing" / suite_id / f"{label}.xml")
        if parsed is None:
            return None
        # The plan's own runtime cases live in the same project; they are judged as cases, not as existing tests.
        # A case is the plan's own only in an approved file: earlier plans' specs reuse the same IDs.
        tags, files = own
        tests = {k: outcome for k, (file, title, outcome) in parsed.items()
                 if not (any(tag in title for tag in tags) and any(same_file(f, file) for f in files))}
        # A red exit explained by any failing test, the plan's own included, is not a separate failure.
        if record["exitCode"] != 0 and all(outcome != "failed" for _, _, outcome in parsed.values()):
            tests[SUITE_EXIT] = "failed"
    else:
        tests[SUITE_EXIT] = "passed" if record["exitCode"] == 0 else "failed"
    return tests


def compare_existing(base, head, rerun):
    """Classify each test by its base and head outcomes; a head failure that passes on rerun is unstable."""
    found = {}
    for key in sorted(set(base) | set(head)):
        before, after = base.get(key), head.get(key)
        if after == "failed":
            if before == "failed":
                kind = "PRE_EXISTING"
            elif rerun is not None and rerun.get(key) == "passed":
                kind = "UNSTABLE"
            else:
                kind = "NEW_FAILURE"
        elif after == "passed" and before == "failed":
            kind = "FIXED"
        elif after in (None, "skipped") and before == "passed":
            kind = "REMOVED"
        else:
            continue
        found.setdefault(kind, []).append(key)
    return found


def existing_status(bundle, suite, base):
    """Compare the project's own suites between base and head."""
    existing = suite.get("existing")
    if existing is None:
        return None
    head_records = load(bundle / "run-manifest.json").get("existing", {})
    base_path = bundle / "base" / "run-manifest.json"
    base_records = load(base_path).get("existing", {}) if base is not None and base_path.exists() else {}
    own = ([f"[{c['id']}]" for c in suite["cases"] if c["kind"] != "pr-test"], suite["files"])
    rows = []
    for entry in existing.get("suites", []):
        records = head_records.get(entry["id"], {})
        head_record, rerun_record, base_record = records.get("head"), records.get("rerun"), base_records.get(entry["id"])
        row = {"id": entry["id"], "status": "PASS", "reason": "", "tests": {},
               "exitCodes": {"base": (base_record or {}).get("exitCode"), "head": (head_record or {}).get("exitCode"),
                             "rerun": (rerun_record or {}).get("exitCode")}}
        rows.append(row)
        head = existing_tests(bundle, entry["id"], "head", head_record, own) if head_record else None
        if head is None:
            row.update(status="NOT_COMPARABLE", reason="Head report missing or unreadable")
            continue
        if base_record is None:
            if "failed" in head.values():
                row.update(status="NOT_COMPARABLE", reason="No usable base run; head failures cannot be told apart from earlier ones",
                           tests={"HEAD_FAILURE": sorted(k for k, v in head.items() if v == "failed")})
            else:
                row["reason"] = "Passes on head; no usable base run"
            continue
        before = existing_tests(bundle / "base", entry["id"], "base", base_record, own)
        if before is None:
            row.update(status="NOT_COMPARABLE", reason="Base report missing or unreadable")
            continue
        rerun = existing_tests(bundle, entry["id"], "rerun", rerun_record, own) if rerun_record else None
        row["tests"] = compare_existing(before, head, rerun)
        if not head_record["report"] and head.get(SUITE_EXIT) == before.get(SUITE_EXIT) == "failed":
            row.update(status="NOT_COMPARABLE", reason="Both revisions exit non-zero and the suite writes no per-test report", tests={})
        elif "NEW_FAILURE" in row["tests"]:
            row.update(status="NEW_FAILURE", reason="Passes on base, fails on head")
        elif {"UNSTABLE", "REMOVED"} & set(row["tests"]):
            row.update(status="NEEDS_REVIEW", reason="Head failure that passed on rerun, or a passing base test missing or skipped on head")
        elif "PRE_EXISTING" in row["tests"]:
            row.update(status="PRE_EXISTING", reason="Fails on base too; not caused by this change")
    return {"suites": rows, "reason": existing.get("reason", "")}


def restore_base(tree, names):
    """Put files copied from the head snapshot back to their base version, so the project's own suites see base only."""
    for name in names:
        tracked = subprocess.run(["git", "cat-file", "-e", f"HEAD:{name}"], cwd=tree, capture_output=True)
        if tracked.returncode:
            local(tree, name).unlink(missing_ok=True)
        else:
            subprocess.run(["git", "checkout", "HEAD", "--", name], cwd=tree, capture_output=True)


def specs(node):
    yield from node.get("specs", [])
    for child in node.get("suites", []):
        yield from specs(child)


def attachment(bundle, value):
    if "body" in value:
        return base64.b64decode(value["body"], validate=True)
    return local(bundle, value["path"]).read_bytes()


def same_file(declared, reported):
    declared, reported = Path(declared).as_posix(), Path(reported).as_posix()
    return declared == reported or declared.endswith("/" + reported)


def native_tests(native, suite):
    existing = [c for c in suite["cases"] if c["kind"] == "pr-test"]
    tests = {}
    for spec in specs(native):
        owner = [c["id"] for c in existing if c["test"]["title"] == spec["title"] and same_file(c["test"]["file"], spec.get("file", ""))]
        match = re.search(r"\[([A-Za-z0-9_.-]+)\]", spec["title"])
        case_id = owner[0] if len(owner) == 1 else match[1] if match else None
        if not case_id or case_id in tests or len(spec.get("tests", [])) != 1:
            raise ValueError("Undeclared, duplicate, or multi-project test")
        tests[case_id] = spec["tests"][0]
    if set(tests) - {c["id"] for c in suite["cases"]}:
        raise ValueError("Native output contains undeclared cases")
    return tests


def observation_document(run, attempt):
    """Parse the unique runtime-observations attachment of an attempt, or return None."""
    found = [a for a in attempt.get("attachments", []) if a.get("name") == "runtime-observations"]
    if len(found) != 1:
        return None
    try:
        observed = json.loads(attachment(run, found[0]))
    except ValueError:
        return None
    return observed if isinstance(observed, dict) else None


def sweep_document(run, attempt, case):
    """The runtime-sweep capture of a sweep test with screenshot names replaced by bundle paths, or (None, why not)."""
    observed = [a for a in attempt.get("attachments", []) if a.get("name") == "runtime-sweep"]
    if len(observed) != 1:
        return None, "Missing a unique runtime-sweep attachment"
    try:
        doc = json.loads(attachment(run, observed[0]))
    except ValueError:
        return None, "Unreadable runtime-sweep attachment"
    pages = doc.get("routes") if isinstance(doc, dict) else None
    if not isinstance(pages, list) or sorted(str(p.get("route")) for p in pages if isinstance(p, dict)) != sorted(case["routes"]):
        return None, "runtime-sweep routes do not match the case's routes"
    shots = {a.get("name"): a for a in attempt.get("attachments", [])}
    captured = []
    for page in pages:
        if not isinstance(page.get("text"), str) or any(
            not isinstance(page.get(k), list) or any(not isinstance(x, str) for x in page[k]) for k in ("requests", "consoleErrors")
        ):
            return None, f"runtime-sweep entry for {page['route']} needs text, requests and consoleErrors"
        shot = shots.get(page.get("screenshot"), {})
        if not shot.get("path"):
            # Inline bodies live only inside native.json; a reviewer needs the image as a file.
            return None, f"Screenshot for {page['route']} must be a file attachment (attach with path, not body)"
        captured.append({"route": page["route"], "text": page["text"], "requests": sorted(page["requests"]),
                         "consoleErrors": sorted(page["consoleErrors"]), "screenshot": shot["path"]})
    return sorted(captured, key=lambda p: p["route"]), ""


def png_pixels(path):
    """Decode an 8-bit, non-interlaced RGB or RGBA PNG (what Playwright writes) to (width, height, rows); None otherwise."""
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    pos, header, chunks = 8, None, []
    while pos + 8 <= len(data):
        length, kind = int.from_bytes(data[pos:pos + 4], "big"), data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + length]
        if kind == b"IHDR":
            header = body
        elif kind == b"IDAT":
            chunks.append(body)
        pos += 12 + length
    if header is None or header[8] != 8 or header[9] not in (2, 6) or header[12] != 0:
        return None
    width, height = int.from_bytes(header[0:4], "big"), int.from_bytes(header[4:8], "big")
    step = 4 if header[9] == 6 else 3
    try:
        raw = zlib.decompress(b"".join(chunks))
    except zlib.error:
        return None
    stride, rows, previous = width * step, [], bytearray(width * step)
    for y in range(height):
        kind, line = raw[y * (stride + 1)], bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        for x in range(stride if kind else 0):
            left = line[x - step] if x >= step else 0
            up, corner = previous[x], previous[x - step] if x >= step else 0
            if kind == 1:
                line[x] = (line[x] + left) & 255
            elif kind == 2:
                line[x] = (line[x] + up) & 255
            elif kind == 3:
                line[x] = (line[x] + (left + up) // 2) & 255
            elif kind == 4:
                guess = left + up - corner
                pa, pb, pc = abs(guess - left), abs(guess - up), abs(guess - corner)
                line[x] = (line[x] + (left if pa <= pb and pa <= pc else up if pb <= pc else corner)) & 255
        rows.append(bytes(line))
        previous = line
    return width, height, rows, step


def changed_pixels(base_path, head_path):
    """Count pixels whose channels differ by more than the tolerance; None when either cannot be decoded or sizes differ."""
    base, head = png_pixels(base_path), png_pixels(head_path)
    if base is None or head is None or base[:2] != head[:2]:
        return None
    step = base[3]
    if head[3] != step:
        return None
    return sum(1 for a, b in zip(base[2], head[2]) if a != b for x in range(0, len(a), step)
               if a[x:x + step] != b[x:x + step] and max(abs(i - j) for i, j in zip(a[x:x + step], b[x:x + step])) > PIXEL_TOLERANCE)


def sweep_status(bundle, suite, head, base_rows, rules):
    """Compare each swept route between base and head: visible text, requests, console errors, screenshot."""
    intent = {r for c in suite["cases"] if c["kind"] != "sweep" and c.get("classification", "new-behavior") == "new-behavior" for r in c.get("routes", [])}
    routes, missing = [], []
    for case in (c for c in suite["cases"] if c["kind"] == "sweep"):
        now, before = head[case["id"]].get("sweep"), base_rows.get(case["id"], {}).get("sweep")
        if now is None or before is None:
            missing.append(case["id"])
            continue
        for page, old in zip(now, before):
            text, old_text = normalized(page["text"], rules), normalized(old["text"], rules)
            requests, old_requests = set(normalized(page["requests"], rules)), set(normalized(old["requests"], rules))
            errors, old_errors = set(normalized(page["consoleErrors"], rules)), set(normalized(old["consoleErrors"], rules))
            pixels = changed_pixels(bundle / "base" / old["screenshot"], bundle / page["screenshot"])
            found = {"route": page["route"], "differs": [], "screenshots": {"base": "base/" + old["screenshot"], "head": page["screenshot"]},
                     "changedPixels": pixels, "mayBelongToIntent": page["route"] in intent}
            if text != old_text:
                lines, old_lines = text.splitlines(), old_text.splitlines()
                found["differs"].append("text")
                found["text"] = {"removed": [x for x in old_lines if x not in lines][:5], "added": [x for x in lines if x not in old_lines][:5]}
            if requests != old_requests:
                found["differs"].append("requests")
                found["requests"] = {"removed": sorted(old_requests - requests), "added": sorted(requests - old_requests)}
            if errors - old_errors:
                found["differs"].append("consoleErrors")
                found["consoleErrors"] = sorted(errors - old_errors)
            if pixels is None or pixels:
                found["differs"].append("screenshot")
            routes.append(found)
    return {"routes": routes, "notCompared": missing}


def regression_status(bundle, suite):
    """Which impact-map routes the plan covers; the map itself is computed by impact.py when the run starts."""
    path = bundle / "impact-map.json"
    if not path.exists():
        return {"error": "Impact map was not computed", "missing": []}
    found = load(path)
    if "error" in found:
        return {**found, "missing": []}
    covered = {r for c in suite["cases"] if c["kind"] not in ("pr-test", "sweep") for r in c.get("routes", [])}
    return {**found, "missing": [r["route"] for r in found["selected"] if r["route"] not in covered]}


def unmeasured_checks(observed):
    """Checks with no actual value at all: JSON drops undefined, as when a page function never ran. A recorded null is a measurement."""
    checks = observed.get("checks") if isinstance(observed, dict) else None
    return [str(c.get("id")) for c in checks if isinstance(c, dict) and "actual" not in c] if isinstance(checks, list) else []


def checks_of(row):
    checks = (row.get("observations") or {}).get("checks")
    if not isinstance(checks, list):
        return {}
    return {c["id"]: c for c in checks if isinstance(c, dict) and isinstance(c.get("id"), str)}


def normalized(value, rules):
    """Apply the suite's normalization rules to every string inside an observed value."""
    if isinstance(value, str):
        for rule in rules:
            value = re.sub(rule["pattern"], rule["replacement"], value)
        return value
    if isinstance(value, list):
        return [normalized(item, rules) for item in value]
    if isinstance(value, dict):
        return {key: normalized(item, rules) for key, item in value.items()}
    return value


def base_diff(head, base, rules):
    """List checks whose actual values still differ between head and base after normalization."""
    head_checks, base_checks = checks_of(head), checks_of(base)
    return [{"id": i, "base": base_checks[i].get("actual"), "head": head_checks[i].get("actual")}
            for i in sorted(set(head_checks) & set(base_checks))
            if normalized(head_checks[i].get("actual"), rules) != normalized(base_checks[i].get("actual"), rules)]


def score_run(run, suite):
    """Score one execution directory: the bundle itself (head) or its base/ directory."""
    manifest = load(run / "run-manifest.json")
    if not (run / "native-raw.json").exists():
        return {}, []
    native = load(run / "native.json")
    if normalize(run, load(run / "native-raw.json"), Path(manifest["projectRoot"])) != native:
        raise ValueError("Normalized results disagree with original native report")
    tests = native_tests(native, suite)
    rows = {}
    for case in suite["cases"]:
        test = tests.get(case["id"], {})
        attempts = test.get("results", [])
        row = {"caseId": case["id"], "result": "NOT_RUN", "attempts": len(attempts), "reasons": []}
        rows[case["id"]] = row
        if not attempts or all(a["status"] == "skipped" for a in attempts):
            row["reasons"].append("Absent or skipped test")
            continue
        if test.get("expectedStatus", "passed") != "passed" or len(attempts) != 1 or attempts[0]["status"] != "passed":
            error = next((str(a["error"].get("message", ""))[:300] for a in attempts if isinstance(a.get("error"), dict)), "")
            row.update(result="FAIL", reasons=["Native failure, expected failure, or retry/flaky execution"],
                       passedAttempt=any(a["status"] == "passed" for a in attempts), error=error)
            observed = observation_document(run, attempts[0]) if case["kind"] != "pr-test" else None
            if observed is not None:
                row["observations"] = observed
                unmeasured = unmeasured_checks(observed)
                if unmeasured:
                    row["reasons"].append(f"No actual value recorded for {', '.join(unmeasured)}: the test did not measure it, so this is a test defect until fixed")
            continue
        attachments = attempts[0].get("attachments", [])
        for item in attachments:
            if "path" in item and (not item["path"].startswith("artifacts/") or not attachment(run, item)):
                raise ValueError("Missing or invalid artifact attachment")
        if case["kind"] == "pr-test":
            row.update(result="PASS", reasons=["Existing PR test; native result only, no runtime observations"])
            continue
        if case["kind"] == "sweep":
            captured, problem = sweep_document(run, attempts[0], case)
            if captured is None:
                row.update(result="BLOCKED", reasons=[problem])
            else:
                row.update(result="PASS", reasons=["Sweep captured; differences from base are reported for review, not scored"], sweep=captured)
            continue
        observations = [a for a in attachments if a["name"] == "runtime-observations"]
        if len(observations) != 1:
            row.update(result="BLOCKED", reasons=["Missing unique structured observations"])
            continue
        observed = json.loads(attachment(run, observations[0]))
        row["observations"] = observed
        checks = observed.get("checks", [])
        by_id = {c["id"]: c for c in checks}
        if len(by_id) != len(checks) or set(by_id) != {c["id"] for c in case["checks"]}:
            row.update(result="BLOCKED", reasons=["Observation checks do not match contract"])
            continue
        if any("actual" not in c or "expected" not in c or not c.get("source") for c in checks):
            unmeasured = unmeasured_checks(observed)
            row.update(result="BLOCKED", reasons=["Missing expected/actual/source" + (f"; no actual value recorded for {', '.join(unmeasured)}" if unmeasured else "")])
            continue
        if any(c["actual"] != c["expected"] for c in checks):
            row.update(result="FAIL", reasons=["Observed expected/actual mismatch"],
                       error="; ".join(c["id"] for c in checks if c["actual"] != c["expected"]) + " mismatched")
            continue
        if not observed.get("actualPath") or observed.get("cleanup") not in {"COMPLETE", "NOT_REQUIRED"}:
            row.update(result="BLOCKED", reasons=["Missing runtime path or completed cleanup"])
            continue
        if case["kind"] == "browser" and not any(a["name"] == "trace" and a.get("path") for a in attachments):
            row.update(result="BLOCKED", reasons=["Browser case lacks trace"])
            continue
        row["result"] = "PASS"
    return rows, native.get("errors", [])


def base_status(bundle, suite):
    if suite.get("base") is None:
        return None, {}
    base = bundle / "base"
    manifest = load(base / "run-manifest.json")
    degraded = manifest.get("degraded")
    rows, errors = ({}, []) if degraded else score_run(base, suite)
    # A sweep passes on any page that loads, so it is not evidence that the base app really ran.
    probes = [c["id"] for c in suite["cases"] if c.get("classification") == "invariant" and c["kind"] != "sweep"]
    if not degraded and probes and not any(rows[i]["result"] == "PASS" for i in probes):
        # Invariant cases double as a health probe: if none passes, the base app was not really exercised.
        degraded = "No invariant case passed on base; the base runtime may not have run"
    if not degraded and errors:
        degraded = "Base run reported global errors: " + str(errors[0].get("message", errors[0]))[:300]
    status = {"revision": manifest["revision"], "gitHead": manifest.get("gitHead", ""), "exitCode": manifest.get("exitCode"), "nativeErrors": errors, "degraded": degraded}
    return status, rows


def proof(case, head, base, base_rows, rules):
    """Classify whether a passing head case is shown able to fail on base."""
    if head["result"] != "PASS":
        return "NOT_EVALUATED", "Head result is not PASS"
    if case["kind"] == "sweep":
        return "NOT_REQUIRED", "Sweep case; base and head are compared, not scored"
    if case.get("classification", "new-behavior") == "invariant":
        return "NOT_REQUIRED", "Invariant case; expected to pass on base too"
    if base is None:
        return "NOT_PROVEN", "Ability to fail not proven: no base revision declared"
    if base["degraded"]:
        return "NOT_PROVEN", "Ability to fail not proven: " + base["degraded"]
    row = base_rows[case["id"]]
    result = row["result"]
    if result == "FAIL" and row.get("passedAttempt"):
        return "NOT_PROVEN", "Ability to fail not proven: flaky on base (an attempt passed)"
    mismatched = [c for c in checks_of(row).values() if c.get("actual") != c.get("expected")]
    if result == "FAIL" and mismatched and all(normalized(c.get("actual"), rules) == normalized(c.get("expected"), rules) for c in mismatched):
        names = ", ".join(c["id"] for c in mismatched)
        return "NOT_PROVEN", f"Ability to fail not proven: base differs only in normalized values ({names})"
    if result == "FAIL":
        detail = f" ({row['error']})" if row.get("error") else ""
        return "PROVEN", f"Fails on base{detail} and passes on head"
    if result == "PASS":
        return "NON_PROVING", "Passes on base too; does not prove the change"
    return "NOT_PROVEN", f"Ability to fail not proven: base result {result}"


def score(bundle):
    manifest = load(bundle / "run-manifest.json")
    suite = load(local(bundle / "inputs", manifest["suite"]))
    head, errors = score_run(bundle, suite)
    base, base_rows = base_status(bundle, suite)
    det = suite.get("determinism")
    rules = (det or {}).get("normalize", [])
    rows = []
    for case in suite["cases"]:
        row = head[case["id"]]
        row["proof"], row["proofReason"] = proof(case, row, base, base_rows, rules)
        if base_rows:
            row["baseResult"] = base_rows[case["id"]]["result"]
            if "observations" in row and "observations" in base_rows[case["id"]]:
                row["baseDiff"] = base_diff(row, base_rows[case["id"]], rules)
        rows.append(row)
    result = {"cases": rows, "exitCode": manifest["exitCode"], "nativeErrors": errors, "base": base, "determinism": det}
    # Bundles from before existing suites were declared keep their original report, so they still audit.
    if suite.get("existing") is not None:
        result["existing"] = existing_status(bundle, suite, base)
    if suite.get("regression") is not None:
        result["regression"] = regression_status(bundle, suite)
    if any(c["kind"] == "sweep" for c in suite["cases"]):
        result["sweep"] = sweep_status(bundle, suite, head, base_rows, rules)
    # Older bundles have none of these inputs; leaving the keys out keeps their recomputed report identical.
    if "mode" in suite:
        result["mode"] = {"name": suite["mode"], "reason": suite["modeReason"], "approved": suite["mode"] == "durable"}
    if "environmentCheck" in manifest:
        result["environment"] = manifest["environmentCheck"]
    if suite.get("blindSpots") is not None:
        result["blindSpots"] = blind_spots_status(suite, head)
    return result


def blind_spots_status(suite, head):
    """Catalog items as declared: applied with the result of each case, skipped with the reason, or asked of the human."""
    applied, skipped, questions = [], [], []
    for entry in suite["blindSpots"]:
        cases = [{"caseId": c, "result": head[c]["result"]} for c in entry.get("cases", [])]
        if "question" in entry:
            questions.append({"item": entry["item"], "question": entry["question"], "cases": cases})
        elif "skipped" in entry:
            skipped.append({"item": entry["item"], "reason": entry["skipped"]})
        else:
            applied.append({"item": entry["item"], "cases": cases})
    return {"applied": applied, "skipped": skipped, "questions": questions}


def summary(result):
    lines = ["# Runtime E2E results", "", "Mechanical proof only; semantic audit still required.", ""]
    mode = result.get("mode")
    if mode is not None:
        approval = "human-approved before the run" if mode["approved"] else "no approval gate; not reviewed by a human before the run"
        lines += [f"Mode: {mode['name']} ({approval}); chosen because {mode['reason']}", ""]
    for row in result["cases"]:
        lines.append(f"- {row['caseId']}: {row['result']} ({row['attempts']} attempt(s)); {'; '.join(row['reasons'])}")
        lines.append(f"  - Can-fail: {row['proof']}; {row['proofReason']}")
        if "baseDiff" in row:
            diff = "; ".join(f"{d['id']}: base {json.dumps(d['base'], ensure_ascii=False)[:80]} vs head {json.dumps(d['head'], ensure_ascii=False)[:80]}" for d in row["baseDiff"])
            lines.append(f"  - Base diff after normalization: {diff or 'none'}")
    lines += ["", f"Execution exit code: {result['exitCode']}", f"Native global errors: {len(result['nativeErrors'])}"]
    base = result["base"]
    if base is None:
        lines.append("Base: not declared; no case has proven ability to fail")
    else:
        lines.append(f"Base revision: {base['revision']} ({base['gitHead'] or 'unresolved'})")
        lines.append(f"Base run: {'DEGRADED: ' + base['degraded'] if base['degraded'] else 'completed'}")
    det = result["determinism"]
    if det is None:
        lines.append("Determinism: not declared; time, seed data, randomness, and IDs are uncontrolled")
    else:
        lines.append(f"Determinism env: {', '.join(sorted(det.get('env', {}))) or 'none'}; normalization rules: {len(det.get('normalize', []))}")
        lines.append(f"Determinism limits: {'; '.join(det.get('limits', [])) or 'none stated'}")
    non_proving = [r["caseId"] for r in result["cases"] if r["proof"] == "NON_PROVING"]
    lines.append(f"Non-proving PASS: {', '.join(non_proving) if non_proving else 'none'}")
    existing = result.get("existing") or {"suites": []}
    if "existing" in result and not existing["suites"]:
        lines.append(f"Existing suites: none; {existing['reason']}")
    for row in existing["suites"]:
        codes = ", ".join(f"{k} exit {v}" for k, v in row["exitCodes"].items() if v is not None)
        lines.append(f"Existing suite {row['id']}: {row['status']}; {row['reason'] or 'no failures'} ({codes})")
        for kind, keys in row["tests"].items():
            more = f" and {len(keys) - 10} more" if len(keys) > 10 else ""
            lines.append(f"  - {kind}: {'; '.join(keys[:10])}{more}")
    found = result.get("regression")
    if found is not None and "error" in found:
        lines.append(f"Impact map: not available; {found['error']}")
    elif found is not None:
        lines.append(f"Impact map: {len(found['changed'])} changed source file(s); {len(found['selected'])} route(s) selected, {len(found['notTested'])} not tested")
        for row in found["selected"]:
            lines.append(f"  - {row['route']} ({row['tier']}): {row['reason']}{'; NO CASE' if row['route'] in found['missing'] else ''}")
        for row in found["notTested"]:
            lines.append(f"  - {row['route']}: found, not tested; {row['reason']}")
        for label, key in (("Shared surfaces changed", "shared"), ("Changed files reaching no key route", "untraced"), ("Changed files outside sources", "outsideSources")):
            if found.get(key):
                lines.append(f"{label}: {', '.join(found[key])}")
        lines += [f"Impact warning: {w}" for w in found["warnings"]]
    sweep = result.get("sweep")
    if sweep is not None:
        differing = [r for r in sweep["routes"] if r["differs"]]
        lines.append(f"Sweep: {len(sweep['routes'])} route(s) compared, {len(differing)} differ{'; not compared: ' + ', '.join(sweep['notCompared']) if sweep['notCompared'] else ''}")
        for row in differing:
            hint = "; may belong to intent" if row["mayBelongToIntent"] else ""
            pixels = "undecodable or resized" if row["changedPixels"] is None else f"{row['changedPixels']} px"
            lines.append(f"  - {row['route']}: {', '.join(row['differs'])} ({pixels}){hint}; base {row['screenshots']['base']}, head {row['screenshots']['head']}")
            for key in ("text", "requests"):
                if key in row:
                    lines.append(f"    - {key}: removed {json.dumps(row[key]['removed'], ensure_ascii=False)[:200]}, added {json.dumps(row[key]['added'], ensure_ascii=False)[:200]}")
            if "consoleErrors" in row:
                lines.append(f"    - new console errors: {json.dumps(row['consoleErrors'], ensure_ascii=False)[:200]}")
    env = result.get("environment")
    if env is not None:
        confirmed = "; run confirmed by the human" if env.get("confirmed") else ""
        lines.append(f"Environment check: {len(env['strong'])} strong, {len(env['weak'])} weak signal(s){confirmed}")
        lines += [f"  - strong: {x}" for x in env["strong"]] + [f"  - weak: {x}" for x in env["weak"]]
    spots = result.get("blindSpots")
    if spots is not None:
        lines.append(f"Blind spots: {len(spots['applied'])} applied, {len(spots['skipped'])} skipped, {len(spots['questions'])} question(s) for the human")
        for row in spots["applied"]:
            lines.append(f"  - {row['item']}: applied in {', '.join(c['caseId'] + ' ' + c['result'] for c in row['cases'])}")
        for row in spots["skipped"]:
            lines.append(f"  - {row['item']}: skipped; {row['reason']}")
        for row in spots["questions"]:
            lines.append(f"  - {row['item']}: question; {row['question']}")
    return "\n".join(lines) + "\n"


def inventory(bundle):
    if any(p.is_symlink() for p in bundle.rglob("*")):
        raise ValueError("Evidence bundle must not contain symlinks")
    # report.html is a view regenerated from the bundle (evidence.py report), not evidence.
    return {str(p.relative_to(bundle)): digest(p) for p in sorted(bundle.rglob("*"))
            if p.is_file() and str(p.relative_to(bundle)) not in ("integrity.json", "report.html")}


def audit(bundle):
    if inventory(bundle) != load(bundle / "integrity.json"):
        raise ValueError("Bundle integrity mismatch")
    approval = load(bundle / "approval.json")
    manifest = load(bundle / "run-manifest.json")
    suite = load(local(bundle / "inputs", manifest["suite"]))
    required = {manifest["suite"], suite["plan"], *suite["files"]}
    light = suite.get("mode") == "light"
    if set(approval["hashes"]) != required or (light != (approval.get("mode") == "light")) or not (light or approval.get("reviewer")):
        raise ValueError("Approval does not cover declared inputs")
    if manifest["command"][:-2] != suite["command"] or manifest["command"][-2] != "--reporter=json":
        raise ValueError("Recorded command disagrees with approved command")
    if any(manifest[k] != suite[k] for k in ("environment", "revision")):
        raise ValueError("Recorded environment/revision disagrees with approved suite")
    approved_existing = {e["id"]: e["command"] for e in (suite.get("existing") or {}).get("suites", [])}
    recorded_existing = [(i, r) for i, runs in manifest.get("existing", {}).items() for r in runs.values()]
    if suite.get("base") is not None:
        base = load(bundle / "base" / "run-manifest.json")
        if base["revision"] != suite["base"]["revision"]:
            raise ValueError("Recorded base revision disagrees with approved suite")
        if "command" in base and (base["command"][:-2] != suite["command"] or base["command"][-2] != "--reporter=json"):
            raise ValueError("Recorded base command disagrees with approved command")
        recorded_existing += list(base.get("existing", {}).items())
    if any(r.get("command") != approved_existing.get(i) for i, r in recorded_existing):
        raise ValueError("Recorded existing suite command disagrees with approved command")
    for name, value in approval["hashes"].items():
        if digest(local(bundle / "inputs", name)) != value:
            raise ValueError("Approved input snapshot mismatch")
    result = score(bundle)
    if result != load(bundle / "results.json") or summary(result) != (bundle / "summary.md").read_text():
        raise ValueError("Generated report disagrees with native evidence")
    print(summary(result))
    unresolved = [c["caseId"] for c in result["cases"] if c["result"] != "PASS" or c["proof"] == "NON_PROVING"]
    problems = [f"unresolved: {', '.join(unresolved)}"] if unresolved else []
    suites = (result.get("existing") or {}).get("suites", [])
    for status, label in (("NEW_FAILURE", "existing suites with new failures"), ("NEEDS_REVIEW", "existing suites needing review"), ("NOT_COMPARABLE", "existing suites not comparable")):
        named = [r["id"] for r in suites if r["status"] == status]
        if named:
            problems.append(f"{label}: {', '.join(named)}")
    found = result.get("regression")
    if found is not None and "error" in found:
        problems.append(f"impact map not available: {found['error']}")
    elif found is not None and found["missing"]:
        problems.append(f"impact routes without a case: {', '.join(found['missing'])}")
    sweep = result.get("sweep")
    if sweep is not None:
        differing = [r["route"] for r in sweep["routes"] if r["differs"]]
        if differing:
            problems.append(f"sweep differences needing review: {', '.join(differing)}")
        if sweep["notCompared"]:
            problems.append(f"sweep not compared: {', '.join(sweep['notCompared'])}")
    questions = [r["item"] for r in (result.get("blindSpots") or {}).get("questions", [])]
    if questions:
        problems.append(f"blind-spot questions for the human: {', '.join(questions)}")
    if result["exitCode"] != 0 or result["nativeErrors"]:
        problems.append(f"native run exit code {result['exitCode']}, {len(result['nativeErrors'])} global error(s)")
    # Exit 1 means the evidence is consistent but the suite is not done; inconsistent evidence exits 2.
    print("Audit: evidence consistent; " + ("; ".join(problems) or "all cases resolved"))
    return 1 if problems else 0


def normalize(run, native, root):
    original = load(run / "run-manifest.json")["artifactRoot"]
    for spec in specs(native):
        for test in spec.get("tests", []):
            for attempt in test.get("results", []):
                for item in attempt.get("attachments", []):
                    if "path" in item:
                        path = Path(item["path"])
                        path = path.resolve() if path.is_absolute() else (root / path).resolve()
                        # Original reports use absolute paths; locate them in a moved bundle too.
                        relative = path.relative_to(original)
                        stored = local(run / "artifacts", str(relative))
                        if not stored.is_file():
                            raise ValueError("Missing artifact attachment")
                        item["path"] = str(stored.relative_to(run))
    return native


def execute(run, cwd, command, extra_env, manifest):
    """Run the approved command once and store its native report under run/."""
    env = os.environ.copy()
    env.update(extra_env, PLAYWRIGHT_JSON_OUTPUT_NAME=str(run / "native.json"))
    command = command + ["--reporter=json", "--output=" + str(run / "artifacts")]
    manifest.update(artifactRoot=str(run / "artifacts"), command=command, startedAt=datetime.now(timezone.utc).isoformat())
    write(run / "run-manifest.json", manifest)
    with (run / "stdout.log").open("wb") as stdout, (run / "stderr.log").open("wb") as stderr:
        try:
            execution = subprocess.run(command, cwd=cwd, env=env, stdout=stdout, stderr=stderr)
            manifest["exitCode"] = execution.returncode
        except OSError as error:
            stderr.write(str(error).encode())
            manifest["exitCode"] = 127
    manifest["finishedAt"] = datetime.now(timezone.utc).isoformat()
    write(run / "run-manifest.json", manifest)
    native_path = run / "native.json"
    if not native_path.exists():
        write(native_path, {"suites": [], "errors": [{"message": "Native output missing; inspect stderr.log"}]})
    (run / "native-raw.json").write_bytes(native_path.read_bytes())
    write(native_path, normalize(run, load(native_path), cwd))


def run_base(bundle, root, data, run_id):
    """Run the approved tests against the base revision in a separate worktree."""
    run = bundle / "base"
    run.mkdir()
    base = data["base"]
    fixed = (data.get("determinism") or {}).get("env", {})
    manifest = {"revision": base["revision"], "projectRoot": "", "gitHead": "", "setup": []}
    resolved = subprocess.run(["git", "rev-parse", "--verify", base["revision"] + "^{commit}"], cwd=root, capture_output=True, text=True)
    if resolved.returncode:
        manifest["degraded"] = f"Base revision {base['revision']} cannot be resolved"
        write(run / "run-manifest.json", manifest)
        return
    manifest["gitHead"] = resolved.stdout.strip()
    tree = Path(tempfile.mkdtemp(prefix="runtime-e2e-base-"))
    try:
        added = subprocess.run(["git", "worktree", "add", "--detach", str(tree), manifest["gitHead"]], cwd=root, capture_output=True, text=True)
        if added.returncode:
            manifest["degraded"] = "Base worktree could not be created: " + added.stderr.strip()[:300]
            return
        manifest["projectRoot"] = str(tree)
        # Tests come from the approved head snapshot; the application and kept files stay at base.
        for name in data["files"]:
            if name in base.get("keep", []):
                continue
            dest = local(tree, name)
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(local(bundle / "inputs", name).read_bytes())
        with (run / "setup.log").open("w", encoding="utf-8") as log:
            for step in base.get("setup", []):
                try:
                    # Setup steps are human-approved argument arrays (hashed with the suite) and run without a shell.
                    done = subprocess.run(step, cwd=tree, env={**os.environ, **fixed, **base["env"]}, capture_output=True, text=True, timeout=SETUP_TIMEOUT)  # nosemgrep: python.lang.security.audit.dangerous-subprocess-use-audit
                    code, output = done.returncode, done.stdout + done.stderr
                except subprocess.TimeoutExpired:
                    code, output = 124, f"timed out after {SETUP_TIMEOUT}s"
                except OSError as error:
                    code, output = 127, str(error)
                log.write(f"$ {step}\n{output}\n[exit {code}]\n")
                manifest["setup"].append({"command": step, "exitCode": code})
                if code:
                    manifest["degraded"] = f"Base setup {step} exited {code}; see base/setup.log"
                    return
        try:
            # The approved head snapshot above already created cwd when it holds a listed file.
            execute(run, local(tree, data.get("cwd", ".")), data["command"], {**fixed, **base["env"], "RUNTIME_E2E_RUN_ID": run_id + "-base"}, manifest)
        except ValueError as error:
            manifest["degraded"] = f"Base native report unusable: {error}"[:300]
        restore_base(tree, [name for name in data["files"] if name not in base.get("keep", [])])
        manifest["existing"] = {e["id"]: run_existing(run, tree, e, base["env"], "base") for e in (data.get("existing") or {}).get("suites", [])}
    finally:
        removed = subprocess.run(["git", "worktree", "remove", "--force", str(tree)], cwd=root, capture_output=True, text=True)
        shutil.rmtree(tree, ignore_errors=True)
        subprocess.run(["git", "worktree", "prune"], cwd=root, capture_output=True)
        listed = subprocess.run(["git", "worktree", "list", "--porcelain"], cwd=root, capture_output=True, text=True).stdout
        left = tree.exists() or f"worktree {tree}" in listed
        manifest["worktreeCleanup"] = "INCOMPLETE: " + removed.stderr.strip()[:300] if left else "COMPLETE"
        write(run / "run-manifest.json", manifest)


def promote(bundle, root, to):
    """Turn a light run into a durable plan without rediscovery: restore its exact inputs and hand them over for approval."""
    audit(bundle)  # an inconsistent bundle raises before anything is written
    manifest = load(bundle / "run-manifest.json")
    suite = load(local(bundle / "inputs", manifest["suite"]))
    if suite.get("mode") != "light":
        raise ValueError("Only a light run is promoted; a durable plan is already in docs/testing")
    target = local(root, str(to))
    if target.relative_to(root).parts[:2] != ("docs", "testing"):
        raise ValueError("A durable plan lives under docs/testing; pass --to inside it")
    plan_name, suite_name = (target / Path(suite["plan"]).name), (target / Path(manifest["suite"]).name)
    writes = {}
    for name in suite["files"]:
        content = local(bundle / "inputs", name).read_bytes()
        path = local(root, name)
        if path.exists() and path.read_bytes() != content:
            raise ValueError(f"{name} changed since the light run; promote refuses to overwrite it")
        writes[path] = content
    for path in (plan_name, suite_name):
        if path.exists():
            raise ValueError(f"{path.relative_to(root)} already exists")
    durable = {**suite, "mode": "durable", "plan": str(plan_name.relative_to(root)),
               "modeReason": f"promoted from light run {manifest['runId']}; human approval still required"}
    writes[plan_name] = local(bundle / "inputs", suite["plan"]).read_bytes()
    writes[suite_name] = (json.dumps(durable, indent=2, ensure_ascii=False) + "\n").encode()
    for path, content in writes.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    print(f"Promoted to {suite_name.relative_to(root)}; remove unwanted cases, validate, then ask the human to approve before a durable run")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["validate", "approve", "run", "audit", "report", "promote"])
    parser.add_argument("target", type=Path)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--reviewer")
    parser.add_argument("--out", type=Path)
    parser.add_argument("--notes", type=Path, help="report: JSON of agent inference by case ID or 'general', shown labeled as inference")
    parser.add_argument("--confirm-environment", action="store_true", help="run: the human confirmed a light run despite strong environment signals")
    parser.add_argument("--to", type=Path, default=Path("docs/testing/active"), help="promote: directory for the durable plan and suite")
    args = parser.parse_args()
    if args.mode == "audit":
        return audit(args.target.resolve())
    if args.mode == "report":
        import report
        bundle = args.target.resolve()
        audit(bundle)  # refuses an inconsistent bundle before rendering it
        notes = load(args.notes) if args.notes else {}
        if not isinstance(notes, dict) or any(not isinstance(v, str) for v in notes.values()):
            raise ValueError("--notes must map case IDs or 'general' to text")
        print(f"Report: {report.write(bundle, notes)}")
        return 0
    if args.mode == "promote":
        return promote(args.target.resolve(), args.root.resolve(), args.to)
    root, suite = args.root.resolve(), args.target.resolve()
    data, hashes = contract(suite, root)
    approval_path = suite.with_name(suite.name + ".approval.json")
    if args.mode == "validate":
        print("Suite and Markdown contract valid")
        if data.get("regression") is not None:
            # Plan-time view of the same map the run records, so cases can be added before approval.
            found = impact.build(root, data["base"]["revision"], data["regression"])
            covered = {r for c in data["cases"] if c["kind"] not in ("pr-test", "sweep") for r in c.get("routes", [])}
            missing = [r["route"] for r in found["selected"] if r["route"] not in covered]
            print(f"Impact routes without a case: {', '.join(missing) or 'none'}")
        return 0
    light = data.get("mode") == "light"
    if args.mode == "approve":
        if light:
            raise ValueError("A light suite runs without an approval gate; promote its run to get a durable plan to approve")
        if not args.reviewer:
            raise ValueError("Explicit human reviewer required")
        write(approval_path, {"reviewer": args.reviewer, "approvedAt": datetime.now(timezone.utc).isoformat(), "hashes": hashes})
        return 0
    checked = environment_check(root, data)
    if light and checked["strong"] and not args.confirm_environment:
        raise ValueError("Strong environment signals stop a light run; ask the human, and rerun with --confirm-environment only after they confirm: " + "; ".join(checked["strong"]))
    if light:
        # Light mode has no approval gate; the snapshot hashes still pin exactly what ran.
        approval = {"mode": "light", "reviewer": None, "approvedAt": None, "hashes": hashes}
    else:
        approval = load(approval_path)
        if approval["hashes"] != hashes or not approval.get("reviewer"):
            raise ValueError("Approval missing or stale; human reapproval required")
    if args.out is None:
        raise ValueError("--out must name a new run directory")
    bundle = args.out.resolve()
    bundle.mkdir(parents=True, exist_ok=False)
    for name in hashes:
        dest = local(bundle / "inputs", name)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(local(root, name).read_bytes())
    write(bundle / "approval.json", approval)
    run_id = str(uuid.uuid4())
    git = subprocess.run(["git", "rev-parse", "HEAD"], cwd=root, capture_output=True, text=True)
    dirty = subprocess.run(["git", "status", "--porcelain"], cwd=root, capture_output=True, text=True)
    manifest = {"runId": run_id, "suite": str(suite.relative_to(root)), "projectRoot": str(root), "environment": data["environment"], "revision": data["revision"], "gitHead": git.stdout.strip(), "gitStatus": dirty.stdout,
                "environmentCheck": {**checked, "confirmed": bool(args.confirm_environment and checked["strong"])}}
    fixed = (data.get("determinism") or {}).get("env", {})
    execute(bundle, command_dir(root, data), data["command"], {**fixed, "RUNTIME_E2E_RUN_ID": run_id}, manifest)
    entries = (data.get("existing") or {}).get("suites", [])
    manifest["existing"] = {e["id"]: {"head": run_existing(bundle, root, e, {}, "head")} for e in entries}
    write(bundle / "run-manifest.json", manifest)
    if data.get("base") is not None:
        run_base(bundle, root, data, run_id)
    if data.get("regression") is not None:
        base_head = load(bundle / "base" / "run-manifest.json").get("gitHead")
        try:
            if not base_head:
                raise ValueError("base revision did not resolve")
            write(bundle / "impact-map.json", impact.build(root, base_head, data["regression"]))
        except (ValueError, OSError) as error:
            write(bundle / "impact-map.json", {"error": str(error)[:300]})
    # A test that passes on base and fails on head is run once more on head before it counts as a new failure.
    for row in (existing_status(bundle, data, {}) or {}).get("suites", []):
        if "NEW_FAILURE" in row["tests"]:
            entry = next(e for e in entries if e["id"] == row["id"])
            manifest["existing"][row["id"]]["rerun"] = run_existing(bundle, root, entry, {}, "rerun")
    write(bundle / "run-manifest.json", manifest)
    result = score(bundle)
    write(bundle / "results.json", result)
    (bundle / "summary.md").write_text(summary(result), encoding="utf-8")
    write(bundle / "integrity.json", inventory(bundle))
    code = audit(bundle)
    import report
    print(f"Report: {report.write(bundle)}")
    return code


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(2)
