#!/usr/bin/env python3
"""Validate the Markdown contract for a runtime E2E plan and ledger."""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path


ALLOWED_STATUSES = {
    "DRAFT",
    "READY",
    "RUNNING",
    "FAILED",
    "BLOCKED",
    "AWAITING_HUMAN",
    "COMPLETED",
}
ALLOWED_RESULTS = {"NOT_RUN", "PASS", "FAIL", "BLOCKED", "INVALIDATED"}
ALLOWED_PRIORITIES = {"RELEASE_BLOCKING", "NORMAL"}
ALLOWED_HUMAN_JUDGMENT = {"YES", "NO"}
ALLOWED_PATH_MATCH = {"NOT_RUN", "YES", "NO"}
ALLOWED_DECISIONS = {"PENDING", "ACCEPTED", "REJECTED"}
ALLOWED_SUPPORTING = {"PASS", "FAIL", "NOT_RUN"}
# Existing-suite statuses that need a human before completion; NEW_FAILURE blocks it outright.
REVIEW_EXISTING = {"NEEDS_REVIEW", "NOT_COMPARABLE"}
ALLOWED_CAN_FAIL = {
    "PROVEN",
    "NON_PROVING",
    "NOT_PROVEN",
    "NOT_REQUIRED",
    "NOT_EVALUATED",
    "NOT_RUN",
}
CLOCK_SKEW = timedelta(minutes=1)
# Matches e.g. "- `npm test`: PASS — 12 passed" or "- `npm run lint`: NOT_RUN — no lint config".
SUPPORTING_CHECK = re.compile(r"^- (?P<check>.+?):\s*(?P<result>[A-Z_]+)\b\s*[—-]?\s*(?P<note>.*?)\s*$")
CASE_HEADING = re.compile(
    r"^## Case (?P<id>[A-Za-z0-9][A-Za-z0-9_.-]*)\s+[—-]\s+(?P<title>.+?)\s*$",
    re.MULTILINE,
)


@dataclass
class Case:
    case_id: str
    title: str
    body: str

    def field(self, name: str) -> str | None:
        match = re.search(
            rf"^- {re.escape(name)}:\s*(.*?)\s*$", self.body, re.MULTILINE
        )
        return match.group(1).strip() if match else None

    def section(self, name: str) -> str | None:
        match = re.search(
            rf"^### {re.escape(name)}\s*$\n(?P<body>.*?)(?=^### |^## |\Z)",
            self.body,
            re.MULTILINE | re.DOTALL,
        )
        return match.group("body").strip() if match else None


def top_field(text: str, name: str, stop: int | None = None) -> str | None:
    search_text = text[:stop] if stop is not None else text
    match = re.search(
        rf"^- {re.escape(name)}:\s*(.*?)\s*$", search_text, re.MULTILINE
    )
    return match.group(1).strip() if match else None


def parse_cases(text: str) -> list[Case]:
    matches = list(CASE_HEADING.finditer(text))
    cases: list[Case] = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        cases.append(
            Case(
                case_id=match.group("id"),
                title=match.group("title").strip(),
                body=text[match.end() : end],
            )
        )
    return cases


def missing_value(value: str | None) -> bool:
    if value is None:
        return True
    normalized = value.strip().upper()
    return not normalized or normalized in {"NOT_RUN", "NOT_STARTED", "TBD", "—", "-"}


def parse_count(text: str, label: str, stop: int | None) -> int | None:
    value = top_field(text, label, stop)
    if value is None or not value.isdigit():
        return None
    return int(value)


def parse_time(value: str | None) -> datetime | None:
    try:
        parsed = datetime.fromisoformat((value or "").replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else None


def top_section(text: str, name: str) -> str | None:
    match = re.search(
        rf"^## {re.escape(name)}\s*$\n(?P<body>.*?)(?=^## |\Z)", text, re.MULTILINE | re.DOTALL
    )
    return match.group("body") if match else None


def check_supporting(text: str, after_run: bool) -> list[str]:
    """Each supporting check carries its own result, so a listed check cannot silently go unrun."""
    section = top_section(text, "Supporting checks")
    if section is None:
        return []
    errors = []
    for line in (line for line in section.splitlines() if line.startswith("- ")):
        match = SUPPORTING_CHECK.match(line)
        if not match or match.group("result") not in ALLOWED_SUPPORTING:
            errors.append(
                f"Supporting check {line[2:]!r} must read '- <check>: PASS|FAIL|NOT_RUN — <evidence or reason>'."
            )
        elif after_run and (match.group("check").startswith("`<") or re.fullmatch(r"<.*>", match.group("note"))):
            errors.append(f"Supporting check {line[2:]!r} is still the template placeholder.")
        elif after_run and match.group("result") == "NOT_RUN" and not match.group("note"):
            errors.append(f"Supporting check {match.group('check')!r} was not run; state why.")
    return errors


def check_cases(cases: list[Case], bundle: Path) -> list[str]:
    """Compare each case's ledger entry with the generated results."""
    try:
        rows = json.loads((bundle / "results.json").read_text(encoding="utf-8"))["cases"]
        rows = {row["caseId"]: row for row in rows}
    except (OSError, ValueError, KeyError, TypeError) as error:
        return [f"Cannot read results in {bundle}: {error}"]
    errors = []
    for case in cases:
        prefix = f"Case {case.case_id}"
        result = case.field("Result")
        row = rows.get(case.case_id)
        if result == "INVALIDATED":
            continue
        if row is None:
            if result != "NOT_RUN":
                errors.append(f"{prefix}: Result is {result}, but the bundle has no result for this case.")
            continue
        if result != row.get("result"):
            errors.append(f"{prefix}: Result is {result}, but the bundle recorded {row.get('result')}.")
        can_fail = case.field("Can-fail")
        if not missing_value(can_fail) and can_fail != row.get("proof"):
            errors.append(f"{prefix}: Can-fail is {can_fail}, but the bundle recorded {row.get('proof')}.")
        recorded_path = (row.get("observations") or {}).get("actualPath")
        if recorded_path and case.field("Actual path") != recorded_path:
            errors.append(
                f"{prefix}: Actual path must be the recorded path {recorded_path!r}; "
                "set Path match by comparing it with the Runtime path."
            )
    return errors


def existing_rows(bundle: Path) -> tuple[list[dict], list[str]]:
    """The generated existing-suite rows; an unreadable results file is already reported by check_cases."""
    try:
        results = json.loads((bundle / "results.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return [], []
    if not isinstance(results, dict) or results.get("existing") is None:
        return [], []
    suites = results["existing"].get("suites") if isinstance(results["existing"], dict) else None
    if not isinstance(suites, list) or not all(isinstance(row, dict) for row in suites):
        return [], [f"Cannot read existing suites in {bundle / 'results.json'}."]
    return suites, []


def regression_open(bundle: Path) -> tuple[list[str], list[str]]:
    """Impact-map routes without a case, and items for the human (swept routes that differ, blind-spot questions), from the generated results."""
    try:
        results = json.loads((bundle / "results.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return [], []
    if not isinstance(results, dict):
        return [], []
    found = results.get("regression") or {}
    missing = ["impact map not available"] if "error" in found else list(found.get("missing", []))
    sweep = results.get("sweep") or {}
    review = [row.get("route") for row in sweep.get("routes", []) if row.get("differs")] + list(sweep.get("notCompared", []))
    review += [row.get("item") for row in (results.get("blindSpots") or {}).get("questions", [])]
    return missing, review


def check_existing(text: str, rows: list[dict]) -> list[str]:
    """Each of the project's own suites is reported with the status the tool generated."""
    section = top_section(text, "Existing suites")
    if section is None:
        return ["Missing '## Existing suites': list each existing suite's generated status, or why none ran."] if rows else []
    reported = {}
    for line in (line for line in section.splitlines() if line.startswith("- ")):
        match = SUPPORTING_CHECK.match(line)
        if match:
            reported[match.group("check").strip("`")] = match.group("result")
    errors = []
    for row in rows:
        status = reported.get(row.get("id"))
        if status is None:
            errors.append(f"Existing suite {row.get('id')!r} must read '- {row.get('id')}: {row.get('status')} — <note>'.")
        elif status != row.get("status"):
            errors.append(f"Existing suite {row.get('id')!r} is {status}, but the bundle recorded {row.get('status')}.")
    return errors


def check_bundle(text: str, top_end: int, bundle: Path) -> list[str]:
    """Compare the ledger's run identity with what the evidence tool recorded."""
    try:
        head = json.loads((bundle / "run-manifest.json").read_text(encoding="utf-8"))
        base_path = bundle / "base" / "run-manifest.json"
        base = json.loads(base_path.read_text(encoding="utf-8")) if base_path.exists() else None
    except (OSError, ValueError) as error:
        return [f"Cannot read run manifest in {bundle}: {error}"]
    errors = []
    run_id = top_field(text, "Run ID", top_end)
    if run_id != head.get("runId"):
        errors.append(f"Run ID is {run_id!r}, but the bundle recorded {head.get('runId')!r}.")
    revisions = top_field(text, "Tested revisions", top_end) or ""
    for label, manifest in (("head", head), ("base", base)):
        sha = (manifest or {}).get("gitHead", "")[:7]
        if sha and not (manifest or {}).get("degraded") and not re.search(rf"\b{sha}", revisions):
            errors.append(f"Tested revisions must name the recorded {label} commit {sha}.")
    finished = [parse_time(m.get("finishedAt")) for m in (head, base) if m and m.get("finishedAt")]
    updated = parse_time(top_field(text, "Last updated", top_end))
    if parse_time(head.get("finishedAt")) is None:
        errors.append("The bundle has no finish time; the run did not complete, so its ledger cannot be validated.")
    elif updated is None:
        errors.append("Last updated must be an ISO 8601 time with a zone, e.g. 2026-01-01T00:00:00Z.")
    elif None not in finished and updated < max(finished):
        errors.append(
            f"Last updated {updated.isoformat()} is before the run finished at {max(finished).isoformat()}; "
            "use the time the ledger was written."
        )
    return errors


def validate(path: Path, mode: str, bundle: Path | None = None) -> tuple[list[str], list[str]]:
    text = path.read_text(encoding="utf-8")
    cases = parse_cases(text)
    errors: list[str] = []
    warnings: list[str] = []
    first_case = CASE_HEADING.search(text)
    top_end = first_case.start() if first_case else len(text)

    status = top_field(text, "Status", top_end)
    decision = top_field(text, "Decision", top_end)

    if status not in ALLOWED_STATUSES:
        errors.append(
            f"Status must be one of {', '.join(sorted(ALLOWED_STATUSES))}; got {status!r}."
        )
    if decision not in ALLOWED_DECISIONS:
        errors.append(
            f"Human sign-off Decision must be one of {', '.join(sorted(ALLOWED_DECISIONS))}; got {decision!r}."
        )

    for field_name in ("Run ID", "Environment", "Tested revisions", "Last updated"):
        if top_field(text, field_name, top_end) is None:
            errors.append(f"Missing required top-level field '{field_name}'.")
    for field_name in ("Environment", "Last updated"):
        if missing_value(top_field(text, field_name, top_end)):
            errors.append(f"Top-level field '{field_name}' must be concrete.")
    updated = parse_time(top_field(text, "Last updated", top_end))
    now = datetime.now(timezone.utc)
    if updated is not None and updated > now + CLOCK_SKEW:
        errors.append(
            f"Last updated {updated.isoformat()} is in the future (now {now.isoformat(timespec='seconds')}); "
            "use the current UTC time."
        )
    existing, unreadable = existing_rows(bundle) if bundle is not None else ([], [])
    if bundle is not None:
        errors.extend(check_bundle(text, top_end, bundle))
        errors.extend(check_cases(cases, bundle))
        errors.extend(unreadable or check_existing(text, existing))
    new_failures = [row.get("id") for row in existing if row.get("status") == "NEW_FAILURE"]
    review = [row.get("id") for row in existing if row.get("status") in REVIEW_EXISTING]
    uncovered, swept = regression_open(bundle) if bundle is not None else ([], [])
    review += swept
    errors.extend(check_supporting(text, bundle is not None or mode == "completion"))
    if not cases:
        errors.append("No cases found. Use headings like '## Case D2 — Title'.")
        return errors, warnings

    duplicate_ids = [
        case_id for case_id, count in Counter(case.case_id for case in cases).items() if count > 1
    ]
    if duplicate_ids:
        errors.append(f"Duplicate case IDs: {', '.join(sorted(duplicate_ids))}.")

    results: Counter[str] = Counter()
    release_total = 0
    release_pass = 0
    human_cases = 0

    for case in cases:
        prefix = f"Case {case.case_id}"
        priority = case.field("Priority")
        human_judgment = case.field("Human judgment")
        result = case.field("Result")
        path_match = case.field("Path match")
        can_fail = case.field("Can-fail")

        if priority not in ALLOWED_PRIORITIES:
            errors.append(f"{prefix}: invalid or missing Priority {priority!r}.")
        if human_judgment not in ALLOWED_HUMAN_JUDGMENT:
            errors.append(
                f"{prefix}: Human judgment must be YES or NO; got {human_judgment!r}."
            )
        if can_fail is not None and can_fail not in ALLOWED_CAN_FAIL:
            errors.append(
                f"{prefix}: Can-fail must be one of {', '.join(sorted(ALLOWED_CAN_FAIL))}; got {can_fail!r}."
            )
        non_proving = result == "PASS" and can_fail == "NON_PROVING"
        if result not in ALLOWED_RESULTS:
            errors.append(f"{prefix}: invalid or missing Result {result!r}.")
        elif non_proving:
            # A test that also passes on base does not prove the change.
            results["NON_PROVING"] += 1
        else:
            results[result] += 1
        if path_match not in ALLOWED_PATH_MATCH:
            errors.append(f"{prefix}: invalid or missing Path match {path_match!r}.")

        runtime_path = case.section("Runtime path")
        expected = case.section("Expected")
        if missing_value(runtime_path):
            errors.append(f"{prefix}: Runtime path is missing or unresolved.")
        if missing_value(expected):
            errors.append(f"{prefix}: Expected is missing or unresolved.")

        if priority == "RELEASE_BLOCKING":
            release_total += 1
            if result == "PASS" and not non_proving:
                release_pass += 1
        if human_judgment == "YES":
            human_cases += 1

        if result == "PASS" and mode == "completion" and missing_value(can_fail):
            errors.append(f"{prefix}: PASS requires the generated Can-fail value at completion.")
        if result == "PASS":
            if path_match != "YES":
                errors.append(f"{prefix}: PASS requires Path match: YES.")
            for field_name in ("Actual path", "Observed", "Evidence", "Cleanup"):
                if missing_value(case.field(field_name)):
                    errors.append(f"{prefix}: PASS requires a concrete {field_name} value.")
        elif result in {"FAIL", "BLOCKED"}:
            for field_name in ("Actual path", "Observed", "Evidence"):
                if missing_value(case.field(field_name)):
                    errors.append(
                        f"{prefix}: {result} requires a concrete {field_name} value."
                    )
        elif result == "INVALIDATED":
            for field_name in ("Observed", "Evidence"):
                if missing_value(case.field(field_name)):
                    errors.append(
                        f"{prefix}: INVALIDATED requires a concrete {field_name} value."
                    )

    expected_summary = {
        "Total": len(cases),
        "PASS": results["PASS"],
        "FAIL": results["FAIL"],
        "BLOCKED": results["BLOCKED"],
        "NOT_RUN": results["NOT_RUN"],
        "INVALIDATED": results["INVALIDATED"],
    }
    if results["NON_PROVING"] or parse_count(text, "Non-proving", top_end) is not None:
        expected_summary["Non-proving"] = results["NON_PROVING"]
    for label, expected_count in expected_summary.items():
        actual = parse_count(text, label, top_end)
        if actual is None:
            errors.append(f"Run summary is missing numeric '{label}'.")
        elif actual != expected_count:
            errors.append(
                f"Run summary {label} is {actual}, but case ledger contains {expected_count}."
            )

    release_summary = top_field(text, "Release-blocking PASS", top_end)
    expected_release = f"{release_pass}/{release_total}"
    if release_summary != expected_release:
        errors.append(
            "Run summary Release-blocking PASS is "
            f"{release_summary!r}, expected {expected_release!r}."
        )

    if mode == "completion":
        if status not in {"AWAITING_HUMAN", "COMPLETED"}:
            errors.append(
                "Completion validation requires Status: AWAITING_HUMAN or COMPLETED."
            )
        for field_name in ("Run ID", "Environment", "Tested revisions", "Last updated"):
            if missing_value(top_field(text, field_name, top_end)):
                errors.append(
                    f"Completion validation requires a concrete '{field_name}'."
                )
        unresolved = (
            results["NOT_RUN"] + results["FAIL"] + results["BLOCKED"] + results["NON_PROVING"]
        )
        if unresolved:
            errors.append(
                f"Completion validation found {unresolved} unresolved case(s)."
            )
        if release_pass != release_total:
            errors.append("Every release-blocking case must PASS before completion.")
        if new_failures:
            errors.append(f"Existing suites fail on head but pass on base: {', '.join(new_failures)}.")
        if uncovered:
            errors.append(f"Impact-map routes have no case: {', '.join(uncovered)}.")
        if status == "AWAITING_HUMAN":
            if human_cases == 0 and not review:
                errors.append(
                    "AWAITING_HUMAN requires a case with Human judgment: YES, an existing suite needing review, a sweep difference, or a blind-spot question."
                )
            if decision != "PENDING":
                errors.append("AWAITING_HUMAN requires Decision: PENDING.")
        if status == "COMPLETED" and (human_cases > 0 or review):
            if decision != "ACCEPTED":
                errors.append(
                    "COMPLETED requires Decision: ACCEPTED when human judgment is required."
                )
            for field_name in ("Reviewer", "Date"):
                if missing_value(top_field(text, field_name, top_end)):
                    errors.append(
                        f"Accepted human sign-off requires a concrete {field_name}."
                    )

    return errors, warnings


def set_field(text: str, name: str, value: str, after: str | None = None) -> str:
    """Set the first '- name: value' line; when missing, insert it after the 'after' field line."""
    line = re.compile(rf"^- {re.escape(name)}:.*$", re.MULTILINE)
    if line.search(text):
        return line.sub(lambda _m: f"- {name}: {value}", text, count=1)
    anchor = re.search(rf"^- {re.escape(after)}:.*$", text, re.MULTILINE) if after else None
    if anchor is None:
        return text
    return text[: anchor.end()] + f"\n- {name}: {value}" + text[anchor.end() :]


def fill(path: Path, bundle: Path) -> None:
    """Copy the generated run identity, case results and existing-suite statuses into the ledger.

    Observed, Evidence, Cleanup, Path match, Status and the sign-off stay the agent's and human's to write.
    """
    text = path.read_text(encoding="utf-8")
    results = json.loads((bundle / "results.json").read_text(encoding="utf-8"))
    head = json.loads((bundle / "run-manifest.json").read_text(encoding="utf-8"))
    base_path = bundle / "base" / "run-manifest.json"
    base = json.loads(base_path.read_text(encoding="utf-8")) if base_path.exists() else None
    rows = {row["caseId"]: row for row in results["cases"]}

    first = CASE_HEADING.search(text)
    top, body = (text[: first.start()], text[first.start() :]) if first else (text, "")
    pieces = []
    for case in parse_cases(body):
        heading = f"## Case {case.case_id} — {case.title}"
        row = rows.get(case.case_id)
        section = case.body
        if row is not None and case.field("Result") != "INVALIDATED":
            section = set_field(section, "Result", row["result"])
            section = set_field(section, "Can-fail", row["proof"], after="Result")
            actual = (row.get("observations") or {}).get("actualPath")
            if actual:
                section = set_field(section, "Actual path", actual, after="Result")
        pieces.append(heading + section)
    body = "".join(pieces)

    top = set_field(top, "Run ID", head["runId"])
    revisions = [f"head {head['gitHead'][:7]}"]
    if base and base.get("gitHead") and not base.get("degraded"):
        revisions.append(f"base {base['gitHead'][:7]}")
    top = set_field(top, "Tested revisions", "; ".join(revisions))
    top = set_field(top, "Last updated", datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"))

    cases = parse_cases(body)
    counts: Counter[str] = Counter()
    release_total = release_pass = 0
    for case in cases:
        result = case.field("Result")
        non_proving = result == "PASS" and case.field("Can-fail") == "NON_PROVING"
        counts["NON_PROVING" if non_proving else result] += 1
        if case.field("Priority") == "RELEASE_BLOCKING":
            release_total += 1
            release_pass += result == "PASS" and not non_proving
    top = set_field(top, "Total", str(len(cases)))
    for label in ("PASS", "FAIL", "BLOCKED", "NOT_RUN", "INVALIDATED"):
        top = set_field(top, label, str(counts[label]))
    if counts["NON_PROVING"] or top_field(top, "Non-proving") is not None:
        top = set_field(top, "Non-proving", str(counts["NON_PROVING"]), after="INVALIDATED")
    top = set_field(top, "Release-blocking PASS", f"{release_pass}/{release_total}")

    suites = (results.get("existing") or {}).get("suites", [])
    if suites:
        current = re.search(r"^## Existing suites\s*$\n(?P<body>.*?)(?=^## |\Z)", top, re.MULTILINE | re.DOTALL)
        section = current.group("body").strip("\n") if current else ""
        for row in suites:
            # Keep the agent's note on a listed suite; only its status comes from the bundle.
            listed = re.compile(rf"^- `?{re.escape(row['id'])}`?:\s*[A-Z_]+", re.MULTILINE)
            if listed.search(section):
                section = listed.sub(lambda _m: f"- {row['id']}: {row['status']}", section, count=1)
            else:
                section += f"\n- {row['id']}: {row['status']} — {row.get('reason') or 'no note'}"
        block = "## Existing suites\n\n" + section.strip("\n") + "\n\n"
        top = top[: current.start()] + block + top[current.end() :] if current else top.rstrip("\n") + "\n\n" + block
    path.write_text(top + body, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate a runtime E2E test-plan Markdown artifact."
    )
    parser.add_argument("plan", type=Path)
    parser.add_argument("--mode", choices=("plan", "completion"), default="plan")
    parser.add_argument(
        "--bundle",
        type=Path,
        help="Evidence run directory; checks the ledger's run identity, case fields and existing suites against it.",
    )
    parser.add_argument(
        "--fill",
        action="store_true",
        help="With --bundle: first copy Run ID, Tested revisions, Last updated, the run summary, each case's Result, "
        "Can-fail and Actual path, and existing-suite statuses from the bundle into the ledger.",
    )
    args = parser.parse_args()

    if not args.plan.is_file():
        print(f"ERROR: plan not found: {args.plan}", file=sys.stderr)
        return 2
    if args.fill:
        if args.bundle is None:
            print("ERROR: --fill needs --bundle", file=sys.stderr)
            return 2
        try:
            fill(args.plan, args.bundle)
        except (OSError, ValueError, KeyError, TypeError) as error:
            print(f"ERROR: cannot fill the ledger from {args.bundle}: {error}", file=sys.stderr)
            return 2

    errors, warnings = validate(args.plan, args.mode, args.bundle)
    for warning in warnings:
        print(f"WARNING: {warning}")
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1

    print(f"Runtime E2E plan is valid for {args.mode}: {args.plan}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
