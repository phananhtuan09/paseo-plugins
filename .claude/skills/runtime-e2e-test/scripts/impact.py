#!/usr/bin/env python3
"""Build a regression impact map: walk the import graph back from changed files to the project's key routes."""
import argparse
import fnmatch
import json
import re
import subprocess
import sys
from pathlib import Path

SOURCE_SUFFIXES = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte", ".css", ".scss")
RESOLVE_SUFFIXES = ("", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte", ".css", ".scss",
                    "/index.ts", "/index.tsx", "/index.js", "/index.jsx")
IMPORT = re.compile(
    r"""(?:\bimport\s+(?:[\w*{}\s,$]+\s+from\s+)?|\bexport\s+[\w*{}\s,$]+\s+from\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|@import\s+(?:url\()?)['"]([^'"]+)['"]"""
)


def config_of(data):
    """Check a suite's regression block and return it with defaults filled in."""
    if not isinstance(data, dict):
        raise ValueError("regression must be an object")
    allowed = {"sources", "aliases", "routes", "shared", "fanIn", "budget"}
    if set(data) - allowed:
        raise ValueError(f"regression takes only {', '.join(sorted(allowed))}")
    sources = data.get("sources")
    if not isinstance(sources, list) or not sources or any(not isinstance(s, str) or not s for s in sources):
        raise ValueError("regression sources must list the source directories")
    routes = data.get("routes")
    if not isinstance(routes, list) or not routes or any(
        not isinstance(r, dict) or set(r) != {"route", "file"} or not all(isinstance(r[k], str) and r[k] for k in r) for r in routes
    ):
        raise ValueError("regression routes must list {route, file} key routes")
    if len({r["route"] for r in routes}) != len(routes):
        raise ValueError("regression routes must be unique")
    aliases = data.get("aliases", {})
    if not isinstance(aliases, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in aliases.items()):
        raise ValueError("regression aliases must map import prefixes to directories")
    shared = data.get("shared", [])
    if not isinstance(shared, list) or any(not isinstance(s, str) or not s for s in shared):
        raise ValueError("regression shared must list glob patterns")
    for key in ("fanIn", "budget"):
        if not isinstance(data.get(key), int) or isinstance(data.get(key), bool) or data[key] < 1:
            raise ValueError(f"regression {key} must be a positive integer")
    return {"sources": sources, "aliases": aliases, "routes": routes, "shared": shared, "fanIn": data["fanIn"], "budget": data["budget"]}


def specifiers(text):
    """Module specifiers named by import, export-from, dynamic import, require, and CSS @import."""
    return IMPORT.findall(text)


def resolve(spec, importer, files, aliases):
    """Map a specifier to a project file, or None for packages and unresolved paths."""
    for prefix, target in sorted(aliases.items(), key=lambda item: -len(item[0])):
        if spec.startswith(prefix):
            spec = target.rstrip("/") + "/" + spec[len(prefix):]
            break
    else:
        if not spec.startswith("."):
            return None
        spec = str(Path(importer).parent / spec)
    parts = []
    for part in Path(spec).as_posix().split("/"):
        if part == "..":
            if parts:
                parts.pop()
        elif part not in ("", "."):
            parts.append(part)
    stem = "/".join(parts)
    for suffix in RESOLVE_SUFFIXES:
        if stem + suffix in files:
            return stem + suffix
    return None


def graph(sources, aliases):
    """Import edges between project files: {file: sorted dependencies}; sources maps path to file text."""
    files = set(sources)
    return {name: sorted({d for s in specifiers(text) if (d := resolve(s, name, files, aliases)) and d != name})
            for name, text in sources.items()}


def matches(name, patterns):
    return any(fnmatch.fnmatch(name, p) for p in patterns)


def reach(edges, start):
    """Shortest import chain from each file that depends on start, back to start itself."""
    importers = {}
    for name, deps in edges.items():
        for dep in deps:
            importers.setdefault(dep, []).append(name)
    chains, queue = {start: [start]}, [start]
    while queue:
        current = queue.pop(0)
        for parent in sorted(importers.get(current, [])):
            if parent not in chains:
                chains[parent] = [parent, *chains[current]]
                queue.append(parent)
    return chains


def impact(edges, changed, config):
    """Tier the key routes a change reaches and select them within the budget; pure and deterministic."""
    route_of = {}
    for r in config["routes"]:
        # One page component can serve several routes, e.g. a form used to create and to edit.
        route_of.setdefault(r["file"], []).append(r["route"])
    files, shared, untraced, routes = [], [], [], {}
    for name in sorted(set(changed)):
        chains = reach(edges, name) if name in edges else {}
        reached = {route: chain for f, chain in chains.items() for route in route_of.get(f, [])}
        entry = {"file": name, "routes": sorted(reached), "fanIn": len(reached)}
        files.append(entry)
        if matches(name, config["shared"]):
            shared.append(name)
        if name in edges and not reached:
            untraced.append(name)
        tier = "shared" if len(reached) > config["fanIn"] else "direct"
        for route, chain in reached.items():
            found = routes.get(route)
            # A route keeps its closest reason; a direct reason outranks a shared one.
            rank = (tier != "direct", len(chain))
            if found is None or rank < (found["tier"] != "direct", len(found["chain"])):
                routes[route] = {"route": route, "tier": tier, "chain": chain,
                                 "reason": f"{' -> '.join(chain[:-1]) or chain[0]} imports {name} (changed)" if len(chain) > 1 else f"{name} changed"}
    direct = sorted((r for r in routes.values() if r["tier"] == "direct"), key=lambda r: r["route"])
    wide = sorted((r for r in routes.values() if r["tier"] == "shared"), key=lambda r: (len(r["chain"]), r["route"]))
    selected = [*direct, *wide[: config["budget"]]]
    not_tested = [{"route": r["route"], "tier": "shared", "reason": f"over budget: {len(wide)} shared-tier routes, budget {config['budget']}"}
                  for r in wide[config["budget"]:]]
    warnings = []
    if len(direct) > config["budget"]:
        warnings.append(f"{len(direct)} direct-tier routes exceed the budget of {config['budget']}; all are still selected")
    if shared or untraced:
        warnings.append("Shared surfaces or untraced files changed; the visual sweep covers what the import graph cannot see")
    return {"changed": files, "shared": shared, "untraced": untraced,
            "selected": [{k: r[k] for k in ("route", "tier", "reason")} for r in selected],
            "notTested": not_tested, "warnings": warnings}


def read_sources(root, config):
    sources = {}
    for folder in config["sources"]:
        base = root / folder
        if not base.is_dir():
            raise ValueError(f"regression source {folder} is not a directory")
        for path in sorted(base.rglob("*")):
            # Test files never reach a route at runtime; the project's own suites cover them.
            test = re.search(r"\.(test|spec)\.[^.]+$", path.name) or "__tests__" in path.parts
            if path.is_file() and path.suffix in SOURCE_SUFFIXES and "node_modules" not in path.parts and not test:
                sources[path.relative_to(root).as_posix()] = path.read_text(encoding="utf-8", errors="replace")
    return sources


def changed_files(root, base):
    """Files that differ between base and the working tree, uncommitted changes included."""
    done = subprocess.run(["git", "diff", "--name-only", base], cwd=root, capture_output=True, text=True)
    if done.returncode:
        raise ValueError(f"Cannot diff against {base}: {done.stderr.strip()[:200]}")
    untracked = subprocess.run(["git", "ls-files", "--others", "--exclude-standard"], cwd=root, capture_output=True, text=True)
    return sorted(set(done.stdout.split()) | set(untracked.stdout.split()))


def build(root, base, config):
    config = config_of(config)
    sources = read_sources(root, config)
    changed = changed_files(root, base)
    result = impact(graph(sources, config["aliases"]), [f for f in changed if f in sources], config)
    # Server code, tests and config are not walked; list them so nothing changed goes unmentioned.
    result["outsideSources"] = [f for f in changed if f not in sources]
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("suite", type=Path, help="suite.json with base.revision and a regression block")
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args()
    data = json.loads(args.suite.read_text(encoding="utf-8"))
    if "regression" not in data or not (data.get("base") or {}).get("revision"):
        raise ValueError("The suite needs base.revision and a regression block")
    print(json.dumps(build(args.root.resolve(), data["base"]["revision"], data["regression"]), indent=2))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(2)
