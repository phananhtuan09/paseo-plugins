#!/usr/bin/env python3
"""Render one offline HTML report from an evidence bundle, for a quick human review."""
import base64
import html
import json
import re
import zipfile
from pathlib import Path

import evidence

STEP_METHODS = {"pw:api", "expect", "test.step"}
CSS = """
body{font:14px/1.45 system-ui,sans-serif;margin:0;background:#f6f7f9;color:#1d2330}
main{max-width:1180px;margin:0 auto;padding:16px}
h1{font-size:22px;margin:8px 0}h2{font-size:18px;margin:28px 0 8px}h3{font-size:15px;margin:0 0 6px}
.card{background:#fff;border:1px solid #d9dde5;border-radius:8px;padding:12px 14px;margin:10px 0}
.badge{display:inline-block;border-radius:10px;padding:1px 8px;font-size:12px;font-weight:600;background:#e8ebf0}
.PASS,.PROVEN,.COVERED{background:#dff3e4;color:#14532d}.FAIL,.NEW_FAILURE,.MISSING{background:#fde2e1;color:#7f1d1d}
.BLOCKED,.NOT_RUN,.NON_PROVING,.NOT_PROVEN,.NEEDS_REVIEW,.NOT_COMPARABLE,.DIFFERS{background:#fdf0d5;color:#713f12}
table{border-collapse:collapse;width:100%;font-size:13px}td,th{border:1px solid #e1e4ea;padding:4px 6px;text-align:left;vertical-align:top}
th{background:#f0f2f6}code{font-size:12px;background:#f0f2f6;padding:0 3px;border-radius:3px;word-break:break-all}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:10px}.shot{position:relative;display:inline-block;max-width:100%}
.shot img{max-width:100%;display:block;border:1px solid #d9dde5}.box{position:absolute;border:3px solid #e11d48;box-sizing:border-box}
.steps li{margin:6px 0}.steps .shot{max-width:440px;display:block;margin-top:4px}.inference{border-left:4px solid #a855f7;background:#faf5ff;padding:6px 10px}
.muted{color:#5b6475}details summary{cursor:pointer}
"""


def esc(value):
    return html.escape(str(value), quote=True)


def badge(value):
    return f'<span class="badge {esc(value)}">{esc(value)}</span>'


def data_uri(content, kind):
    return f"data:{kind};base64,{base64.b64encode(content).decode()}"


def shot(content, kind, box=None, size=None):
    """An embedded image with an optional outline; box is (x, y, width, height) in the image's own pixels."""
    outline = ""
    if box and size and size[0] and size[1]:
        x, y, w, h = box
        outline = (f'<div class="box" style="left:{100 * x / size[0]:.2f}%;top:{100 * y / size[1]:.2f}%;'
                   f'width:{max(100 * w / size[0], 0.6):.2f}%;height:{max(100 * h / size[1], 0.6):.2f}%"></div>')
    return f'<div class="shot"><img alt="" src="{data_uri(content, kind)}">{outline}</div>'


def lines_of(text):
    return [json.loads(line) for line in text.splitlines() if line.strip()]


def trace_steps(path):
    """Test steps from a Playwright trace, each with its target box and the last screencast frame before it ended."""
    try:
        archive = zipfile.ZipFile(path)
    except (OSError, zipfile.BadZipFile):
        return []
    names = archive.namelist()
    if "test.trace" not in names:
        return []
    events = lines_of(archive.read("test.trace").decode("utf-8", "replace"))
    ended = {e["callId"]: e.get("endTime") for e in events if e.get("type") == "after"}
    errors = {e["callId"]: (e.get("error") or {}).get("message", "") for e in events if e.get("type") == "after" and e.get("error")}
    boxes, frames, steps_of = {}, [], {}
    for name in names:
        if not name.endswith(".trace") or name == "test.trace":
            continue
        for e in lines_of(archive.read(name).decode("utf-8", "replace")):
            if e.get("type") == "before" and e.get("stepId"):
                steps_of[e["callId"]] = e["stepId"]
            elif e.get("type") == "input" and isinstance(e.get("box"), dict):
                boxes[e["callId"]] = e["box"]
            elif e.get("type") == "screencast-frame" and e.get("file") in names:
                frames.append(e)
    target = {steps_of[c]: b for c, b in boxes.items() if c in steps_of}
    frames.sort(key=lambda f: f["timestamp"])
    steps, last = [], None
    for e in events:
        if e.get("type") != "before" or e.get("parentId") or e.get("method") not in STEP_METHODS:
            continue
        end = ended.get(e["callId"]) or e.get("startTime", 0)
        frame = next((f for f in reversed(frames) if f["timestamp"] <= end), None)
        image = None
        if frame is not None and frame["file"] != last:
            image = (archive.read(frame["file"]), (frame.get("width"), frame.get("height")))
            last = frame["file"]
        box = target.get(e["callId"])
        # Typed values can be passwords or tokens; the report never repeats them.
        title = re.sub(r'^(Fill|Type|Press sequentially) ".*"$', r"\1 (value hidden)", e.get("title", ""), flags=re.S)
        steps.append({"title": title, "subtitle": e.get("subtitle", ""), "error": errors.get(e["callId"], ""),
                      "box": (box["x"], box["y"], box["width"], box["height"]) if box else None, "image": image})
    return steps


def traces(run, test):
    """Trace archives a case's attempts attached, oldest attempt first."""
    found = []
    for attempt in test.get("results", []):
        for item in attempt.get("attachments", []):
            if item.get("name") == "trace" and item.get("path"):
                found.append(run / item["path"])
    return found


def native_of(run, suite):
    try:
        return evidence.native_tests(evidence.load(run / "native.json"), suite)
    except (OSError, ValueError, KeyError):
        return {}


def changed_box(base_path, head_path):
    """Bounding box (x, y, width, height) of pixels that changed beyond the tolerance, with the image size."""
    base, head = evidence.png_pixels(base_path), evidence.png_pixels(head_path)
    if base is None or head is None or base[:2] != head[:2] or base[3] != head[3]:
        return None, None
    step, xs, ys = base[3], [], []
    for y, (a, b) in enumerate(zip(base[2], head[2])):
        if a == b:
            continue
        for x in range(0, len(a), step):
            if max(abs(i - j) for i, j in zip(a[x:x + step], b[x:x + step])) > evidence.PIXEL_TOLERANCE:
                xs.append(x // step)
                ys.append(y)
    if not xs:
        return None, base[:2]
    return (min(xs), min(ys), max(xs) - min(xs) + 1, max(ys) - min(ys) + 1), base[:2]


def plan_titles(plan_text):
    return dict(re.findall(r"^## Case ([A-Za-z0-9_.-]+)\s+[—-]\s+(.+)$", plan_text, re.M))


def human_cases(plan_text):
    """Cases the approved plan marks for human judgment."""
    found, current = [], None
    for line in plan_text.splitlines():
        heading = re.match(r"^## Case ([A-Za-z0-9_.-]+)\s", line)
        if heading:
            current = heading[1]
        elif current and re.match(r"^- Human judgment:\s*YES\b", line):
            found.append(current)
    return found


def mode_line(mode):
    if mode is None:
        return ""
    gate = "approved by a human before the run" if mode["approved"] else "no approval gate: nobody reviewed these tests before the run"
    return f"<p><b>Mode: {esc(mode['name'])}</b> ({esc(gate)}). Chosen because {esc(mode['reason'])}.</p>"


def blind_spots_section(spots):
    out = [f"<h2>Blind spots</h2><p>{len(spots['applied'])} applied, {len(spots['skipped'])} skipped, {len(spots['questions'])} question(s) for you.</p>",
           "<table><tr><th>Item</th><th>Outcome</th><th>Detail</th></tr>"]
    for row in spots["applied"]:
        cases = " ".join(f"<a href='#case-{esc(c['caseId'])}'>{esc(c['caseId'])}</a> {badge(c['result'])}" for c in row["cases"])
        out.append(f"<tr><td><code>{esc(row['item'])}</code></td><td>applied</td><td>{cases}</td></tr>")
    out += [f"<tr><td><code>{esc(r['item'])}</code></td><td>question</td><td>{esc(r['question'])}</td></tr>" for r in spots["questions"]]
    out += [f"<tr><td><code>{esc(r['item'])}</code></td><td>skipped</td><td>{esc(r['reason'])}</td></tr>" for r in spots["skipped"]]
    out.append("</table>")
    return "".join(out)


def open_items(result):
    """The same unresolved and review items the audit reports, as data."""
    items = [("Unresolved case", c["caseId"], f"{c['result']} / {c['proof']}") for c in result["cases"]
             if c["result"] != "PASS" or c["proof"] == "NON_PROVING"]
    items += [("Existing suite", r["id"], r["status"]) for r in (result.get("existing") or {}).get("suites", [])
              if r["status"] in ("NEW_FAILURE", "NEEDS_REVIEW", "NOT_COMPARABLE")]
    found = result.get("regression")
    if found is not None and "error" in found:
        items.append(("Impact map", "not available", found["error"]))
    elif found is not None:
        items += [("Impact route without a case", r, "") for r in found["missing"]]
    sweep = result.get("sweep")
    if sweep is not None:
        items += [("Sweep difference", r["route"], ", ".join(r["differs"])) for r in sweep["routes"] if r["differs"]]
        items += [("Sweep not compared", c, "") for c in sweep["notCompared"]]
    items += [("Blind-spot question", r["item"], r["question"]) for r in (result.get("blindSpots") or {}).get("questions", [])]
    return items


def case_card(case, row, base_row, titles, head_test, base_test, bundle, notes):
    checks = {c["id"]: c for c in case.get("checks", [])}
    head_checks, base_checks = evidence.checks_of(row), evidence.checks_of(base_row or {})
    parts = [f'<div class="card" id="case-{esc(case["id"])}"><h3>{esc(case["id"])} — {esc(titles.get(case["id"], ""))}</h3>',
             f'<p>Head {badge(row["result"])} Base {badge((base_row or {}).get("result", "NOT_RUN"))} Can-fail {badge(row["proof"])} '
             f'<span class="muted">{esc(row["proofReason"])}</span></p>',
             f'<p class="muted">{esc(case["kind"])} · {esc(case.get("classification", "new-behavior"))}'
             f'{" · routes " + esc(", ".join(case["routes"])) if case.get("routes") else ""} · {esc("; ".join(row["reasons"]))}</p>']
    if checks:
        parts.append("<table><tr><th>Check</th><th>Source</th><th>Expected</th><th>Head actual</th><th>Base actual</th></tr>")
        for check_id, check in checks.items():
            head_value = head_checks.get(check_id, {}).get("actual", "—")
            base_value = base_checks.get(check_id, {}).get("actual", "—")
            mark = " ✗" if head_value != check["expected"] else ""
            parts.append(f"<tr><td>{esc(check_id)}{mark}</td><td>{esc(check['source'])}</td><td><code>{esc(json.dumps(check['expected'], ensure_ascii=False))}</code></td>"
                         f"<td><code>{esc(json.dumps(head_value, ensure_ascii=False))}</code></td><td><code>{esc(json.dumps(base_value, ensure_ascii=False))}</code></td></tr>")
        parts.append("</table>")
    actual = (row.get("observations") or {}).get("actualPath")
    if actual:
        parts.append(f"<p>Actual path (recorded): <code>{esc(actual)}</code></p>")
    if row.get("error"):
        parts.append(f"<p>Error: <code>{esc(row['error'])}</code></p>")
    head_traces = traces(bundle, head_test)
    steps = trace_steps(head_traces[0]) if head_traces else []
    if steps:
        parts.append(f"<details open><summary>Steps from the head trace ({len(steps)})</summary><ol class='steps'>")
        for step in steps:
            error = f" <span class='badge FAIL'>{esc(step['error'][:200])}</span>" if step["error"] else ""
            parts.append(f"<li><b>{esc(step['title'])}</b> <code>{esc(step['subtitle'])}</code>{error}")
            if step["image"]:
                parts.append(shot(step["image"][0], "image/jpeg", step["box"], step["image"][1]))
            parts.append("</li>")
        parts.append("</ol></details>")
    elif case["kind"] == "browser":
        parts.append("<p class='muted'>No trace recorded for this case.</p>")
    base_traces = traces(bundle / "base", base_test) if base_test else []
    base_steps = trace_steps(base_traces[0]) if base_traces else []
    pair = [next((s["image"] for s in reversed(found) if s["image"]), None) for found in (base_steps, steps)]
    if all(pair):
        parts.append("<p>Last frame, base (left) and head (right):</p><div class='pair'>"
                     + "".join(shot(image[0], "image/jpeg") for image in pair) + "</div>")
    if notes.get(case["id"]):
        parts.append(f"<div class='inference'><b>Agent inference, not evidence:</b> {esc(notes[case['id']])}</div>")
    parts.append("</div>")
    return "".join(parts)


def sweep_card(row, reasons, bundle):
    base_path, head_path = bundle / row["screenshots"]["base"], bundle / row["screenshots"]["head"]
    box, size = changed_box(base_path, head_path)
    why = reasons.get(row["route"])
    parts = [f'<div class="card"><h3>{esc(row["route"])} {badge("DIFFERS")}</h3>',
             f'<p>{esc(", ".join(row["differs"]))}; changed pixels {esc(row["changedPixels"] if row["changedPixels"] is not None else "undecodable or resized")}'
             f'{" · may belong to intent" if row["mayBelongToIntent"] else ""}</p>']
    if why:
        parts.append(f"<p class='muted'>In scope: {esc(why)}</p>")
    for key in ("text", "requests"):
        if key in row:
            parts.append(f"<p>{key}: removed <code>{esc(json.dumps(row[key]['removed'], ensure_ascii=False))}</code>, "
                         f"added <code>{esc(json.dumps(row[key]['added'], ensure_ascii=False))}</code></p>")
    if "consoleErrors" in row:
        parts.append(f"<p>New console errors: <code>{esc(json.dumps(row['consoleErrors'], ensure_ascii=False))}</code></p>")
    images = [p.read_bytes() if p.is_file() else None for p in (base_path, head_path)]
    if all(images):
        parts.append("<p>Base (left) and head (right); the outline bounds every changed pixel:</p><div class='pair'>"
                     + shot(images[0], "image/png", box, size) + shot(images[1], "image/png", box, size) + "</div>")
    parts.append("</div>")
    return "".join(parts)


def build(bundle, notes=None):
    """The report HTML for a bundle; it reads only bundle files, plus optional agent notes labeled as inference."""
    notes = notes or {}
    manifest = evidence.load(bundle / "run-manifest.json")
    suite = evidence.load(evidence.local(bundle / "inputs", manifest["suite"]))
    plan_path = bundle / "inputs" / suite["plan"]
    plan_text = plan_path.read_text(encoding="utf-8") if plan_path.is_file() else ""
    titles = plan_titles(plan_text)
    result = evidence.load(bundle / "results.json")
    rows = {r["caseId"]: r for r in result["cases"]}
    base_manifest = bundle / "base" / "run-manifest.json"
    base_rows = {}
    if result.get("base") and not result["base"].get("degraded") and base_manifest.is_file():
        base_rows = {k: v for k, v in evidence.score_run(bundle / "base", suite)[0].items()}
    head_tests, base_tests = native_of(bundle, suite), native_of(bundle / "base", suite) if base_rows else {}
    items = open_items(result)
    base = result.get("base")
    level = "Real E2E against the running app" + (
        f"; base run DEGRADED: {base['degraded']}" if base and base.get("degraded") else "; no base declared" if base is None else "")
    out = [f"<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
           f"<title>Runtime E2E report</title><style>{CSS}</style></head><body><main>",
           f"<h1>Runtime E2E report {badge('NEEDS ATTENTION' if items else 'ALL RESOLVED')}</h1>",
           f"<p>Run <code>{esc(manifest.get('runId', ''))}</code> · {esc(manifest.get('environment', ''))}<br>"
           f"Base <code>{esc((base or {}).get('gitHead', '') or 'none')}</code> → head <code>{esc(manifest.get('gitHead', ''))}</code>"
           f"{' (uncommitted changes recorded)' if manifest.get('gitStatus') else ''}<br>{esc(level)}<br>"
           f"Command <code>{esc(' '.join(manifest.get('command', [])))}</code></p>",
           mode_line(result.get("mode")),
           "<p class='muted'>Everything below comes from the evidence bundle; only boxes marked as agent inference were written by the agent. "
           "The audit (<code>evidence.py audit</code>) stays the source of truth.</p>",
           "<h2>Claims</h2><table><tr><th>Case</th><th>Title (plan)</th><th>Kind</th><th>Routes</th><th>Head</th><th>Base</th><th>Can-fail</th></tr>"]
    for case in suite["cases"]:
        row = rows[case["id"]]
        out.append(f"<tr><td><a href='#case-{esc(case['id'])}'>{esc(case['id'])}</a></td><td>{esc(titles.get(case['id'], ''))}</td>"
                   f"<td>{esc(case['kind'])}, {esc(case.get('classification', 'new-behavior'))}</td><td>{esc(', '.join(case.get('routes', [])))}</td>"
                   f"<td>{badge(row['result'])}</td><td>{badge(row.get('baseResult', 'NOT_RUN') if base else '—')}</td><td>{badge(row['proof'])}</td></tr>")
    out.append("</table>")
    if items:
        out.append("<h2>Needs a decision</h2><table><tr><th>Item</th><th>Name</th><th>Detail</th></tr>")
        out += [f"<tr><td>{esc(a)}</td><td>{esc(b)}</td><td>{esc(c)}</td></tr>" for a, b, c in items]
        out.append("</table>")
    found = result.get("regression")
    reasons = {}
    if found is not None and "error" not in found:
        reasons = {r["route"]: r["reason"] for r in found["selected"]}
        covering = {}
        for case in suite["cases"]:
            for route in case.get("routes", []):
                covering.setdefault(route, []).append(case["id"])
        out.append("<h2>Regressions</h2><h3>Impact map</h3><table><tr><th>Route</th><th>Tier</th><th>Why in scope</th><th>Cases</th></tr>")
        for r in found["selected"]:
            cases = ", ".join(covering.get(r["route"], [])) or badge("MISSING")
            out.append(f"<tr><td>{esc(r['route'])}</td><td>{esc(r['tier'])}</td><td>{esc(r['reason'])}</td><td>{cases}</td></tr>")
        out.append("</table>")
    elif found is not None:
        out.append(f"<h2>Regressions</h2><p>Impact map not available: {esc(found['error'])}</p>")
    sweep = result.get("sweep")
    if sweep is not None:
        differing = [r for r in sweep["routes"] if r["differs"]]
        out.append(f"<h3>Visual sweep</h3><p>{len(sweep['routes'])} route(s) compared, {len(differing)} differ. Differences are findings for review, never scored.</p>")
        out += [sweep_card(r, reasons, bundle) for r in differing]
    existing = (result.get("existing") or {}).get("suites", [])
    if existing:
        out.append("<h3>Project test suites (base and head)</h3><table><tr><th>Suite</th><th>Status</th><th>Tests</th></tr>")
        for r in existing:
            tests = "<br>".join(f"{esc(k)}: {esc('; '.join(v[:10]))}" for k, v in r["tests"].items())
            out.append(f"<tr><td>{esc(r['id'])}</td><td>{badge(r['status'])}</td><td>{tests or esc(r['reason'] or 'no failures')}</td></tr>")
        out.append("</table>")
    if result.get("blindSpots") is not None:
        out.append(blind_spots_section(result["blindSpots"]))
    out.append("<h2>Cases</h2>")
    for case in suite["cases"]:
        out.append(case_card(case, rows[case["id"]], base_rows.get(case["id"]), titles, head_tests.get(case["id"], {}),
                             base_tests.get(case["id"]), bundle, notes))
    limits = []
    if found is not None and "error" not in found:
        limits += [f"Found, not tested: {r['route']} ({r['reason']})" for r in found["notTested"]]
        limits += [f"Impact warning: {w}" for w in found["warnings"]]
        limits += [f"Changed outside the scanned sources: {', '.join(found['outsideSources'])}"] if found.get("outsideSources") else []
    limits += [f"Flaky: {r['caseId']} needed {r['attempts']} attempts" for r in result["cases"] if r["attempts"] > 1]
    limits += [f"Ability to fail not proven: {r['caseId']} ({r['proofReason']})" for r in result["cases"] if r["proof"] == "NOT_PROVEN"]
    det = result.get("determinism")
    limits += [f"Determinism limit: {x}" for x in (det or {}).get("limits", [])] if det else ["Determinism not declared"]
    limits += [f"Native global error: {str(e.get('message', e))[:200]}" for e in result.get("nativeErrors", [])]
    projects = [x for x in manifest.get("command", []) if x.startswith("--project")]
    limits.append(f"Browsers/viewports: only {', '.join(projects) or 'the default project'} ran")
    env = result.get("environment") or {"strong": [], "weak": []}
    limits += [f"Environment signal (strong{', run confirmed by the human' if env.get('confirmed') else ''}): {x}" for x in env["strong"]]
    limits += [f"Environment signal (weak): {x}" for x in env["weak"]]
    out.append("<h2>Limits</h2><ul>" + "".join(f"<li>{esc(x)}</li>" for x in limits) + "</ul>")
    review = human_cases(plan_text)
    out.append("<h2>Human confirmation</h2><ul>")
    out += [f"<li>{esc(a)}: {esc(b)} {esc(c)}</li>" for a, b, c in items if a in ("Sweep difference", "Existing suite", "Blind-spot question")]
    out += [f"<li>Subjective review: {esc(c)}</li>" for c in review]
    out.append("<li>Sign-off decision is recorded in the plan ledger, never here.</li></ul>")
    if notes.get("general"):
        out.append(f"<div class='inference'><b>Agent inference, not evidence:</b> {esc(notes['general'])}</div>")
    out.append("</main></body></html>")
    return "\n".join(out)


def write(bundle, notes=None):
    target = bundle / "report.html"
    target.write_text(build(bundle, notes), encoding="utf-8")
    return target
