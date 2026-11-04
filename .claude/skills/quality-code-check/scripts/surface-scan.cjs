#!/usr/bin/env node
"use strict";

// Deterministic surface scan of the added lines in a diff, driven by references/surface-rules.md.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const DEFAULT_RULES = path.join(__dirname, "..", "references", "surface-rules.md");
const LEVELS = ["Nên sửa", "Tuỳ chọn"];
const JS_LIKE = new Set(["js", "jsx", "ts", "tsx", "mjs", "cjs", "vue"]);
const HASH_COMMENT = new Set(["py", "sh", "rb", "yml", "yaml", "toml"]);
const I18N_PACKAGES = ["i18next", "react-i18next", "react-intl", "vue-i18n", "next-intl", "svelte-i18n", "@lingui/core", "@formatjs/intl"];

function usage(message) {
  if (message) process.stderr.write(`ERROR: ${message}\n`);
  process.stderr.write("usage: surface-scan.cjs [--root DIR] [--base REF | --diff FILE|-] [--rules FILE] [--format json|md]\n");
  process.exit(2);
}

function parseArgs(argv) {
  const args = { root: process.cwd(), rules: DEFAULT_RULES, format: "json" };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!["--root", "--base", "--diff", "--rules", "--format"].includes(key)) usage(`unknown argument ${key}`);
    if (value === undefined) usage(`${key} needs a value`);
    args[key.slice(2)] = value;
    i += 1;
  }
  if (args.base && args.diff) usage("use --base or --diff, not both");
  if (!["json", "md"].includes(args.format)) usage("--format must be json or md");
  args.root = path.resolve(args.root);
  return args;
}

// Split a Markdown table row on unescaped pipes, then unescape `\|`.
function cells(line) {
  const parts = [];
  let current = "";
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === "\\" && line[i + 1] === "|") {
      current += "|";
      i += 1;
    } else if (line[i] === "|") {
      parts.push(current.trim());
      current = "";
    } else {
      current += line[i];
    }
  }
  parts.push(current.trim());
  return parts.slice(1, -1);
}

function unquote(cell) {
  const match = /^`(.*)`$/.exec(cell);
  return match ? match[1] : cell;
}

function listSetting(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function loadRules(file) {
  const text = fs.readFileSync(file, "utf8");
  const settings = {};
  const rules = [];
  let section = "";
  text.split(/\r?\n/).forEach((line) => {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      section = heading[1].toLowerCase();
      return;
    }
    if (section === "settings") {
      const setting = /^-\s*([\w-]+)\s*:\s*(.*?)\s*$/.exec(line);
      if (setting) settings[setting[1]] = setting[2];
      return;
    }
    if (section !== "rules" || !line.trim().startsWith("|")) return;
    const row = cells(line.trim());
    if (row.length < 6 || /^-+$/.test(row[0].replace(/[\s:]/g, "")) || row[0] === "ID") return;
    const [id, category, level, files, check, what] = row.map(unquote);
    if (!LEVELS.includes(level)) throw new Error(`rule ${id}: level must be one of ${LEVELS.join(", ")}`);
    const rule = { id, category, level, files: files === "*" ? null : new Set(listSetting(files)), what };
    if (check === "judgment") {
      rule.kind = "judgment";
    } else if (check.startsWith("builtin:")) {
      rule.kind = "builtin";
      rule.builtin = check.slice("builtin:".length);
      if (!BUILTINS[rule.builtin]) throw new Error(`rule ${id}: unknown builtin ${rule.builtin}`);
    } else {
      rule.kind = "regex";
      const flags = check.startsWith("(?i)") ? "i" : "";
      try {
        rule.regex = new RegExp(flags ? check.slice(4) : check, flags);
      } catch (error) {
        throw new Error(`rule ${id}: invalid regex: ${error.message}`);
      }
    }
    rules.push(rule);
  });
  if (!rules.length) throw new Error(`no rules found in ${file}`);
  const ids = rules.map((rule) => rule.id);
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate) throw new Error(`duplicate rule id ${duplicate}`);
  return { settings, rules };
}

function globRegex(pattern) {
  let source = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === "*" && pattern[i + 1] === "*") {
      source += ".*";
      i += 1;
      if (pattern[i + 1] === "/") i += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  // A pattern without a slash matches the file name in any directory.
  return new RegExp(pattern.includes("/") ? `^${source}$` : `(^|/)${source}$`);
}

function matcher(patterns) {
  const regexes = patterns.map(globRegex);
  return (file) => regexes.some((regex) => regex.test(file));
}

function readDiff(args) {
  if (args.diff === "-") return fs.readFileSync(0, "utf8");
  if (args.diff) return fs.readFileSync(path.resolve(args.diff), "utf8");
  const range = args.base ? [`${args.base}...HEAD`] : ["HEAD"];
  const result = spawnSync("git", ["-c", "core.quotePath=off", "diff", "--no-color", "--no-ext-diff", "-U3", ...range], { cwd: args.root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git diff failed: ${(result.stderr || "").trim()}`);
  return result.stdout;
}

// Git quotes a path with special bytes as a C string ("b/\\303\\241.md"); decode it to UTF-8.
function diffPath(raw, prefix) {
  let value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    const bytes = [];
    const body = value.slice(1, -1);
    const escapes = { n: 10, t: 9, r: 13, '"': 34, "\\": 92, a: 7, b: 8, f: 12, v: 11 };
    for (let i = 0; i < body.length; i += 1) {
      if (body[i] !== "\\") {
        bytes.push(...Buffer.from(body[i], "utf8"));
      } else if (/[0-7]{3}/.test(body.slice(i + 1, i + 4))) {
        bytes.push(parseInt(body.slice(i + 1, i + 4), 8));
        i += 3;
      } else {
        bytes.push(escapes[body[i + 1]] !== undefined ? escapes[body[i + 1]] : body.charCodeAt(i + 1));
        i += 1;
      }
    }
    value = Buffer.from(bytes).toString("utf8");
  }
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

// Parse a unified diff into files with their added and removed lines.
function parseDiff(text) {
  const files = [];
  let file = null;
  let hunk = null;
  let newLine = 0;
  text.split("\n").forEach((line) => {
    if (line.startsWith("diff --git ")) {
      file = { path: null, added: [], removed: [], hunks: [], binary: false, deleted: false };
      files.push(file);
      hunk = null;
      return;
    }
    if (!file) return;
    if (!hunk) {
      if (line.startsWith("+++ ")) {
        const target = line.slice(4).trim();
        if (target === "/dev/null") file.deleted = true;
        else file.path = diffPath(target, "b/");
        return;
      }
      if (line.startsWith("--- ")) {
        if (!file.path) file.oldPath = diffPath(line.slice(4), "a/");
        return;
      }
      if (line.startsWith("Binary files ")) file.binary = true;
    }
    const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (header) {
      newLine = Number(header[1]);
      hunk = { added: [], removed: [] };
      file.hunks.push(hunk);
      return;
    }
    if (!hunk) return;
    if (line.startsWith("+")) {
      const entry = { line: newLine, text: line.slice(1) };
      file.added.push(entry);
      hunk.added.push(entry);
      newLine += 1;
    } else if (line.startsWith("-")) {
      file.removed.push(line.slice(1));
      hunk.removed.push(line.slice(1));
    } else if (line.startsWith(" ")) {
      newLine += 1;
    } else if (line.startsWith("diff ")) {
      hunk = null;
    }
  });
  return files.filter((entry) => entry.path && !entry.deleted && !entry.binary);
}

function extension(file) {
  const base = file.split("/").pop();
  const index = base.lastIndexOf(".");
  return index > 0 ? base.slice(index + 1).toLowerCase() : "";
}

function isComment(text, ext) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (HASH_COMMENT.has(ext)) return trimmed.startsWith("#");
  return trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*") || trimmed.startsWith("<!--");
}

function stripStrings(text) {
  return text.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
}

function projectFiles(root) {
  const listed = spawnSync("git", ["-c", "core.quotePath=off", "ls-files"], { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (listed.status === 0) return listed.stdout.split("\n").filter(Boolean);
  const found = [];
  const walk = (dir) => {
    fs.readdirSync(path.join(root, dir), { withFileTypes: true }).forEach((entry) => {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) return;
      const relative = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(relative);
      else if (entry.isFile()) found.push(relative);
    });
  };
  if (fs.existsSync(root)) walk("");
  return found;
}

// The new side of the diff, only when its lines are the ones the diff numbered; otherwise size checks skip the file.
function newSide(context, file) {
  let text = null;
  if (context.revision) {
    const shown = spawnSync("git", ["show", `${context.revision}:${file.path}`], { cwd: context.root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    if (shown.status === 0) text = shown.stdout;
  } else {
    text = readProjectFile(context.root, file.path);
  }
  const lines = text === null ? null : text.split("\n");
  if (lines && file.added.every((entry) => lines[entry.line - 1] === entry.text)) return text;
  context.skipped.push({ file: file.path, reason: text === null ? "new side not readable" : "working tree differs from the diff" });
  return null;
}

function readProjectFile(root, file) {
  try {
    return fs.readFileSync(path.join(root, file), "utf8");
  } catch (error) {
    return null;
  }
}

// What the project defines, read once and only when a builtin needs it.
function projectFacts(root) {
  let cached = null;
  return () => {
    if (cached) return cached;
    const files = projectFiles(root);
    let colorTokens = 0;
    let spacingTokens = 0;
    files.filter((file) => ["css", "scss", "less"].includes(extension(file))).forEach((file) => {
      const text = readProjectFile(root, file) || "";
      const definitions = text.match(/^\s*--[\w-]+\s*:[^;]+;/gm) || [];
      definitions.forEach((definition) => {
        if (/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(definition)) colorTokens += 1;
        if (/\d+(px|rem|em)\b/.test(definition)) spacingTokens += 1;
      });
    });
    const tokenFile = files.some((file) => /(^|\/)(design-)?tokens?\.(json|js|ts|css|scss)$|(^|\/)tailwind\.config\.\w+$/.test(file));
    let i18n = files.some((file) => /(^|\/)(i18n|locales|translations)\//.test(file));
    const manifest = readProjectFile(root, "package.json");
    if (!i18n && manifest) {
      try {
        const data = JSON.parse(manifest);
        const deps = Object.assign({}, data.dependencies, data.devDependencies);
        i18n = I18N_PACKAGES.some((name) => Object.prototype.hasOwnProperty.call(deps, name));
      } catch (error) {
        i18n = false;
      }
    }
    cached = { colors: tokenFile || colorTokens >= 3, spacing: tokenFile || spacingTokens >= 3, i18n };
    return cached;
  };
}

function finding(rule, file, line, text, note) {
  return { rule: rule.id, category: rule.category, level: rule.level, file, line, text: text.trim().slice(0, 200), note: note || rule.what };
}

const BUILTINS = {
  "comment-ratio"(rule, file, context) {
    const ext = extension(file.path);
    const comments = file.added.filter((entry) => isComment(entry.text, ext));
    const code = file.added.filter((entry) => entry.text.trim() && !isComment(entry.text, ext));
    const ratio = Number(context.settings["comment-ratio"] || 0.6);
    const minimum = Number(context.settings["min-comment-lines"] || 5);
    if (comments.length < minimum || comments.length <= ratio * Math.max(code.length, 1)) return [];
    return [finding(rule, file.path, comments[0].line, comments[0].text, `${comments.length} added comment lines against ${code.length} added code lines`)];
  },

  "magic-number"(rule, file, context) {
    if (context.isTest(file.path)) return [];
    const ext = extension(file.path);
    const allowed = new Set(listSetting(context.settings["magic-number-allow"]));
    const results = [];
    file.added.forEach((entry) => {
      if (isComment(entry.text, ext)) return;
      if (/^\s*(export\s+)?(const|final|static\s+final)\s+[A-Z][A-Z0-9_]*\s*[:=]/.test(entry.text)) return;
      if (/^\s*[A-Z][A-Z0-9_]*\s*=/.test(entry.text) || /^\s*(import|from|export\s+\*)\b/.test(entry.text)) return;
      // A number given a name by its own declaration, such as `const retryDelay = 250;`, is not magic.
      if (/^\s*(export\s+)?((const|let|var|final|static)\s+)*[A-Za-z_$][\w$]*\s*(:\s*[\w.]+)?\s*=\s*-?[\d_.]+\s*;?\s*(\/\/.*|#.*)?$/.test(entry.text)) return;
      if ((entry.text.match(/[\w-]+\s*:\s*[^;:]+;/g) || []).length >= 2) return; // inline CSS text
      // Indexes and slices are positions, not magic values.
      const code = stripStrings(entry.text).replace(/\[[^\[\]]*\]/g, "[]")
        .replace(/>[^<>{}]*</g, "><"); // visible JSX text is copy, not logic
      const numbers = code.match(/(?<![\w.$#-])\d{2,}(?:\.\d+)?(?![\w%.])/g) || [];
      const magic = numbers.filter((value) => !allowed.has(value) && !allowed.has(String(Number(value))));
      if (magic.length) results.push(finding(rule, file.path, entry.line, entry.text, `unnamed number ${magic[0]}`));
    });
    return results;
  },

  "function-size"(rule, file, context) {
    const text = newSide(context, file);
    if (text === null) return [];
    const lines = text.split("\n");
    const added = new Set(file.added.map((entry) => entry.line));
    const maximum = Number(context.settings["max-function-lines"] || 80);
    const start = /^\s*(export\s+)?(default\s+)?(async\s+)?function\b|^\s*(export\s+)?(const|let)\s+\w+\s*=\s*(async\s*)?(\([^)]*\)|\w+)\s*(:\s*[^=]+)?=>\s*\{\s*$|^\s*(public\s+|private\s+|protected\s+|static\s+|async\s+)*\w+\s*\([^)]*\)\s*(:\s*[^{]+)?\{\s*$/;
    const results = [];
    for (let index = 0; index < lines.length; index += 1) {
      const number = index + 1;
      if (!added.has(number) || !start.test(lines[index]) || /^\s*(if|for|while|switch|catch)\b/.test(lines[index])) continue;
      let depth = 0;
      let opened = false;
      let end = index;
      for (; end < lines.length; end += 1) {
        const code = stripStrings(lines[end]);
        depth += (code.match(/\{/g) || []).length - (code.match(/\}/g) || []).length;
        if (depth > 0) opened = true;
        if (opened && depth <= 0) break;
      }
      const length = end - index + 1;
      // Count only a function this change added: its whole body is added lines.
      let ownAdded = 0;
      for (let line = number; line <= end + 1; line += 1) if (added.has(line)) ownAdded += 1;
      if (opened && length > maximum && ownAdded === length) {
        results.push(finding(rule, file.path, number, lines[index], `function of ${length} lines (max ${maximum})`));
      }
    }
    return results;
  },

  "file-size"(rule, file, context) {
    const text = newSide(context, file);
    if (text === null) return [];
    const total = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
    const before = total - file.added.length + file.removed.length;
    const maximum = Number(context.settings["max-file-lines"] || 400);
    if (total <= maximum || before > maximum) return [];
    return [finding(rule, file.path, file.added.length ? file.added[0].line : 1, "", `file grew from ${before} to ${total} lines (max ${maximum})`)];
  },

  "hardcoded-style"(rule, file, context) {
    const facts = context.facts();
    if (!facts.colors && !facts.spacing) return [];
    const ext = extension(file.path);
    const results = [];
    file.added.forEach((entry) => {
      if (isComment(entry.text, ext) || /^\s*--[\w-]+\s*:/.test(entry.text)) return;
      if (facts.colors && /(^|[^\w&])#[0-9a-fA-F]{3}([0-9a-fA-F]{3}([0-9a-fA-F]{2})?)?\b|\b(rgba?|hsla?)\(\s*\d/.test(entry.text)) {
        results.push(finding(rule, file.path, entry.line, entry.text, "literal color while the project defines color tokens"));
      } else if (facts.spacing && /\b(margin|padding|gap|inset|top|right|bottom|left)[\w-]*\s*:\s*[^;]*\b[1-9]\d*px\b/.test(entry.text) && !/var\(/.test(entry.text)) {
        results.push(finding(rule, file.path, entry.line, entry.text, "literal pixel spacing while the project defines spacing tokens"));
      }
    });
    return results;
  },

  "hardcoded-ui-string"(rule, file, context) {
    if (context.isTest(file.path) || !context.facts().i18n) return [];
    const results = [];
    file.added.forEach((entry) => {
      const text = entry.text;
      if (/^\s*(\/\/|\/\*|\*|import\b)/.test(text)) return;
      // Text between tags, text alone on a JSX line, or a visible attribute value.
      const between = /<[A-Za-z][\w.]*(?:\s[^<>]*)?>([^<>{}]*[A-Za-z]{2,}[^<>{}]*)<\//.exec(text);
      // A lone capitalized word is usually an identifier, such as the last name in a multi-line import.
      const alone = /^\s*([A-Z][a-z]+(?:(?: |, |')[A-Za-z]+)+[.!?:]?|[A-Z][a-z]+[.!?:])\s*$/.exec(text);
      const attribute = /\b(?:placeholder|title|aria-label|alt|label)="([^"{}]*[A-Za-z]{2,}[^"{}]*)"/.exec(text);
      const match = attribute || between || alone;
      if (match) results.push(finding(rule, file.path, entry.line, text, `inline UI text "${match[1].trim()}" while the project uses i18n`));
    });
    return results;
  },

  "formatting-noise"(rule, file) {
    const squash = (line) => line.replace(/\s+/g, "");
    let whitespace = 0;
    let first = null;
    let reordered = false;
    file.hunks.forEach((hunk) => {
      const removed = hunk.removed.map(squash);
      const pairs = [];
      hunk.added.forEach((entry) => {
        const index = removed.indexOf(squash(entry.text));
        if (index >= 0 && squash(entry.text)) {
          pairs.push({ entry, before: hunk.removed[index] });
          removed[index] = null;
        }
      });
      // Re-indentation is part of a structural edit when the hunk also changes real code.
      const structural = pairs.length < hunk.added.length || removed.some((line) => line);
      pairs.forEach(({ entry, before }) => {
        if (before === entry.text) return;
        if (structural && before.trim() === entry.text.trim()) return;
        whitespace += 1;
        if (!first) first = entry;
      });
    });
    const imports = (lines) => lines.filter((line) => /^\s*(import\s|from\s+\S+\s+import\s|const\s+\w+\s*=\s*require\()/.test(line)).map(squash);
    const removedImports = imports(file.removed);
    const addedImports = imports(file.added.map((entry) => entry.text));
    // The same import lines removed and re-added elsewhere: they only moved.
    if (removedImports.length && removedImports.length === addedImports.length
      && removedImports.slice().sort().join("\n") === addedImports.slice().sort().join("\n")) {
      reordered = true;
    }
    const results = [];
    if (whitespace) results.push(finding(rule, file.path, first.line, first.text, `${whitespace} whitespace-only line change(s)`));
    if (reordered) {
      const firstImport = file.added.find((entry) => /^\s*(import\s|from\s|const\s+\w+\s*=\s*require\()/.test(entry.text));
      results.push(finding(rule, file.path, firstImport.line, firstImport.text, "imports reordered without other import changes"));
    }
    return results;
  },
};

function applies(rule, file) {
  return !rule.files || rule.files.has(extension(file));
}

function scan(diffText, options) {
  const { settings, rules } = loadRules(options.rules);
  const ignored = matcher(listSetting(settings.ignore));
  const isTest = matcher(listSetting(settings.tests));
  const context = { root: options.root, revision: options.base ? "HEAD" : null, settings, isTest, facts: projectFacts(options.root), skipped: [] };
  const files = parseDiff(diffText).filter((file) => !ignored(file.path));
  const findings = [];
  files.forEach((file) => {
    rules.forEach((rule) => {
      if (!applies(rule, file.path)) return;
      if (rule.kind === "regex") {
        file.added.forEach((entry) => {
          if (rule.regex.test(entry.text)) findings.push(finding(rule, file.path, entry.line, entry.text));
        });
      } else if (rule.kind === "builtin") {
        findings.push(...BUILTINS[rule.builtin](rule, file, context));
      }
    });
  });
  // One item per rule and file, so a repeated pattern does not fill the cap.
  const grouped = [];
  const byKey = {};
  findings.forEach((item) => {
    const key = `${item.rule}\u0000${item.file}`;
    if (byKey[key]) {
      byKey[key].lines.push(item.line);
      return;
    }
    byKey[key] = Object.assign({}, item, { lines: [item.line] });
    grouped.push(byKey[key]);
  });
  grouped.forEach((item) => {
    if (item.lines.length > 1) item.note = `${item.note} (${item.lines.length} lines: ${item.lines.slice(0, 5).join(", ")}${item.lines.length > 5 ? ", ..." : ""})`;
  });
  findings.length = 0;
  findings.push(...grouped);
  const order = (item) => LEVELS.indexOf(item.level);
  findings.sort((a, b) => order(a) - order(b) || a.category.localeCompare(b.category) || a.file.localeCompare(b.file) || a.line - b.line);
  const cap = Number(settings.cap || 10);
  return {
    files: files.map((file) => file.path),
    cap,
    findings,
    shown: findings.slice(0, cap),
    hidden: findings.length > cap ? countBy(findings.slice(cap), "category") : {},
    skipped: context.skipped.filter((item, index, all) => all.findIndex((other) => other.file === item.file) === index),
    judgment: rules.filter((rule) => rule.kind === "judgment").map((rule) => ({ rule: rule.id, category: rule.category, level: rule.level, what: rule.what })),
  };
}

function countBy(items, key) {
  return items.reduce((counts, item) => {
    counts[item[key]] = (counts[item[key]] || 0) + 1;
    return counts;
  }, {});
}

function markdown(result) {
  const lines = ["## Bề mặt code", ""];
  if (!result.findings.length) {
    lines.push("Không có phát hiện từ bước quét tự động trên các dòng thêm mới.");
  } else {
    lines.push("| Loại | Vị trí | Bằng chứng | Mức |", "| --- | --- | --- | --- |");
    result.shown.forEach((item) => {
      const quote = item.text ? `\`${item.text.replace(/`/g, "'").replace(/\|/g, "\\|")}\`; ` : "";
      lines.push(`| ${item.category} (\`${item.rule}\`) | \`${item.file}:${item.line}\` | ${quote}${item.note.replace(/\|/g, "\\|")} | ${item.level} |`);
    });
    const hidden = Object.entries(result.hidden);
    if (hidden.length) {
      const total = result.findings.length - result.shown.length;
      lines.push("", `Còn ${total} phát hiện khác không hiển thị: ${hidden.map(([category, count]) => `${category} ${count}`).join(", ")}.`);
    }
  }
  if (result.skipped.length) lines.push("", `Bỏ qua kiểm tra kích thước: ${result.skipped.map((item) => `\`${item.file}\` (${item.reason})`).join(", ")}.`);
  lines.push("", `Quét ${result.files.length} file; chỉ xét các dòng thêm mới. Các quy tắc cần đánh giá thủ công: ${result.judgment.map((rule) => `\`${rule.rule}\``).join(", ")}.`);
  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let result;
  try {
    result = scan(readDiff(args), args);
  } catch (error) {
    process.stderr.write(`ERROR: ${error.message}\n`);
    process.exit(2);
  }
  process.stdout.write(args.format === "md" ? `${markdown(result)}\n` : `${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { scan, parseDiff, loadRules, markdown };
