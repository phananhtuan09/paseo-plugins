import assert from "node:assert/strict";
import { test } from "node:test";
import { langForPath, tokenize } from "./highlight.ts";

const kinds = (text: string, lang: any) => tokenize(text, lang).filter((t) => t.kind !== "plain").map((t) => `${t.kind}:${t.text}`);

test("tokens always join back to the input", () => {
  const samples: [string, any][] = [
    ["grep -rn 'a b' /tmp && echo \"x $HOME\" | wc -l # done", "sh"],
    ["const a = `t${1}`; // c\n/* b\nc */ return 1.5e3;", "js"],
    ['def f():\n  """doc"""\n  return None', "py"],
    ['{"a": [1, true, null]}', "json"],
    ["key: 'v' # note", "yaml"],
    ["unterminated 'string and \"quote and `tick", "sh"],
  ];
  for (const [text, lang] of samples) assert.equal(tokenize(text, lang).map((t) => t.text).join(""), text);
});

test("shell colors commands, flags, strings, variables and operators", () => {
  assert.deepEqual(kinds("grep -rn 'x y' $DIR | wc -l", "sh"), [
    "command:grep",
    "flag:-rn",
    "string:'x y'",
    "variable:$DIR",
    "operator:|",
    "command:wc",
    "flag:-l",
  ]);
});

test("shell starts a new command after && and a newline, and treats env assignments as variables", () => {
  assert.deepEqual(kinds("cd a && ls\nFOO=1 make", "sh"), [
    "command:cd",
    "operator:&&",
    "command:ls",
    "variable:FOO=1",
    "command:make",
  ]);
});

test("shell hash starts a comment only at a word start", () => {
  assert.deepEqual(kinds("echo a#b # real", "sh"), ["command:echo", "comment:# real"]);
});

test("js colors keywords, strings, numbers and comments", () => {
  assert.deepEqual(kinds('const n = 42; // hi\nreturn "s";', "js"), [
    "keyword:const",
    "number:42",
    "comment:// hi",
    "keyword:return",
    "string:\"s\"",
  ]);
});

test("identifiers containing a keyword or digits are not split", () => {
  assert.deepEqual(kinds("constant x1 = returned", "js"), []);
});

test("json colors strings, numbers and literals", () => {
  assert.deepEqual(kinds('{"a": 1, "b": true}', "json"), ['string:"a"', "number:1", 'string:"b"', "keyword:true"]);
});

test("python triple quotes span lines", () => {
  assert.deepEqual(kinds('"""a\nb"""\nx = 1', "py"), ['string:"""a\nb"""', "number:1"]);
});

test("langForPath maps known extensions and ignores others", () => {
  assert.equal(langForPath("/a/b/step.tsx"), "js");
  assert.equal(langForPath("run.SH"), "sh");
  assert.equal(langForPath("notes.txt"), undefined);
  assert.equal(langForPath("Makefile"), undefined);
});
