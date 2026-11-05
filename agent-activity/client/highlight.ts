import type { BodyLang } from "../shared/activity.ts";

export type TokenKind = "plain" | "comment" | "string" | "number" | "keyword" | "command" | "flag" | "operator" | "variable";

export interface Token {
  kind: TokenKind;
  text: string;
}

const JS_KEYWORDS = new Set(
  "async await break case catch class const continue default delete do else enum export extends false finally for from function if implements import in instanceof interface let new null of private protected public readonly return static super switch this throw true try type typeof undefined var void while yield".split(
    " ",
  ),
);
const PY_KEYWORDS = new Set(
  "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield".split(
    " ",
  ),
);
const LITERALS = new Set(["true", "false", "null", "yes", "no"]);

interface Rule {
  kind: TokenKind;
  pattern: RegExp;
}

const STRING_DOUBLE = /"(?:\\.|[^"\\\n])*"?/y;
const STRING_SINGLE = /'(?:\\.|[^'\\\n])*'?/y;
const NUMBER = /(?:0x[\da-f]+|\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?)\b/iy;
const WORD = /[A-Za-z_$][\w$]*/y;

const RULES: Record<Exclude<BodyLang, "sh">, { rules: Rule[]; keywords: Set<string> }> = {
  js: {
    keywords: JS_KEYWORDS,
    rules: [
      { kind: "comment", pattern: /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y },
      { kind: "string", pattern: /`(?:\\[\s\S]|[^`\\])*`?|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?/y },
    ],
  },
  py: {
    keywords: PY_KEYWORDS,
    rules: [
      { kind: "comment", pattern: /#[^\n]*/y },
      { kind: "string", pattern: /"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?/y },
    ],
  },
  json: { keywords: LITERALS, rules: [{ kind: "string", pattern: STRING_DOUBLE }] },
  yaml: {
    keywords: LITERALS,
    rules: [
      { kind: "comment", pattern: /#[^\n]*/y },
      { kind: "string", pattern: /"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?/y },
    ],
  },
};

const EXTENSIONS: Record<string, BodyLang> = {
  ts: "js", tsx: "js", js: "js", jsx: "js", mjs: "js", cjs: "js",
  json: "json", jsonc: "json",
  py: "py",
  sh: "sh", bash: "sh", zsh: "sh",
  yaml: "yaml", yml: "yaml", toml: "yaml",
};

/** Highlight language for a file path, or undefined when the extension is not recognized. */
export function langForPath(path: string): BodyLang | undefined {
  const match = /\.([A-Za-z0-9]+)$/.exec(path);
  return match ? EXTENSIONS[match[1].toLowerCase()] : undefined;
}

/** Split text into colored tokens. Never throws, and the token texts always join back to the input. */
export function tokenize(text: string, lang: BodyLang): Token[] {
  const tokens: Token[] = [];
  const push = (kind: TokenKind, value: string) => {
    const last = tokens[tokens.length - 1];
    if (last && last.kind === kind && kind === "plain") last.text += value;
    else tokens.push({ kind, text: value });
  };
  if (lang === "sh") scanShell(text, push);
  else scanCode(text, RULES[lang], push);
  return tokens;
}

function matchAt(pattern: RegExp, text: string, index: number): string | undefined {
  pattern.lastIndex = index;
  const result = pattern.exec(text);
  return result && result[0] !== "" ? result[0] : undefined;
}

function scanCode(
  text: string,
  spec: { rules: Rule[]; keywords: Set<string> },
  push: (kind: TokenKind, value: string) => void,
): void {
  let index = 0;
  while (index < text.length) {
    let matched: { kind: TokenKind; value: string } | undefined;
    for (const rule of spec.rules) {
      const value = matchAt(rule.pattern, text, index);
      if (value) {
        matched = { kind: rule.kind, value };
        break;
      }
    }
    if (!matched) {
      const number = matchAt(NUMBER, text, index);
      const word = matchAt(WORD, text, index);
      if (word) matched = { kind: spec.keywords.has(word) ? "keyword" : "plain", value: word };
      else if (number && !/[\w$]/.test(text[index - 1] ?? "")) matched = { kind: "number", value: number };
    }
    const value = matched?.value ?? text[index];
    push(matched?.kind ?? "plain", value);
    index += value.length;
  }
}

const SH_STRING = /"(?:\\[\s\S]|[^"\\])*"?|'[^']*'?/y;
const SH_VARIABLE = /\$\{[^}]*\}?|\$[A-Za-z_]\w*|\$[?$!#@*0-9]/y;
const SH_OPERATOR = /&&|\|\||>>|\d?>&\d|[|;&<>()]/y;
const SH_WORD = /[^\s"'$|;&<>()]+/y;

function scanShell(text: string, push: (kind: TokenKind, value: string) => void): void {
  let index = 0;
  let expectCommand = true;
  while (index < text.length) {
    const char = text[index];
    if (char === "\n") {
      expectCommand = true;
      push("plain", char);
      index += 1;
      continue;
    }
    if (/\s/.test(char)) {
      push("plain", char);
      index += 1;
      continue;
    }
    const atWordStart = index === 0 || /\s/.test(text[index - 1]);
    if (char === "#" && atWordStart) {
      const value = /[^\n]*/y;
      const comment = matchAt(value, text, index) ?? "#";
      push("comment", comment);
      index += comment.length;
      continue;
    }
    const string = matchAt(SH_STRING, text, index);
    if (string) {
      push("string", string);
      index += string.length;
      expectCommand = false;
      continue;
    }
    const variable = matchAt(SH_VARIABLE, text, index);
    if (variable) {
      push("variable", variable);
      index += variable.length;
      continue;
    }
    const operator = matchAt(SH_OPERATOR, text, index);
    if (operator) {
      push("operator", operator);
      index += operator.length;
      if (/^(&&|\|\||[|;&(])$/.test(operator)) expectCommand = true;
      continue;
    }
    const word = matchAt(SH_WORD, text, index);
    if (!word) {
      push("plain", char);
      index += 1;
      continue;
    }
    index += word.length;
    if (expectCommand && /^[A-Za-z_]\w*=/.test(word)) {
      push("variable", word);
    } else if (expectCommand) {
      push("command", word);
      expectCommand = false;
    } else if (atWordStart && /^--?[A-Za-z0-9]/.test(word)) {
      push("flag", word);
    } else if (/^\d+$/.test(word)) {
      push("number", word);
    } else {
      push("plain", word);
    }
  }
}
