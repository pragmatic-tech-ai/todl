import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { collectTodlPaths, runSyntaxCheck, syntaxDiagnostics, uniquePaths } from "../checker.js";

const CONCEPTS = `namespace ea { concept Component { label : string; } }`;
const BAD = `namespace app { Component teamsChat { } component @@@ { } }`;

test("syntaxDiagnostics drops semantic errors", () => {
  const diagnostics = syntaxDiagnostics([
    { uri: "c.todl", text: CONCEPTS },
    { uri: "bad.todl", text: BAD },
  ]);
  assert.ok(diagnostics.length > 0);
  assert.ok(diagnostics.every((d) => d.code.startsWith("syntax.")));
  assert.ok(diagnostics.some((d) => d.span?.uri === "bad.todl"));
});

test("collectTodlPaths walks directories and keeps a single file", () => {
  const root = mkdtempSync(join(tmpdir(), "todl-syntax-"));
  mkdirSync(join(root, "nested"));
  writeFileSync(join(root, "a.todl"), CONCEPTS);
  writeFileSync(join(root, "nested", "b.todl"), CONCEPTS);
  writeFileSync(join(root, "note.txt"), "nope");
  const found = collectTodlPaths(root);
  assert.deepEqual(found, [join(root, "a.todl"), join(root, "nested", "b.todl")].sort());
  assert.deepEqual(collectTodlPaths(join(root, "a.todl")), [join(root, "a.todl")]);
});

test("runSyntaxCheck reports syntax errors and ignores semantic ones", () => {
  const root = mkdtempSync(join(tmpdir(), "todl-syntax-"));
  writeFileSync(join(root, "model.todl"), BAD);
  const lines: string[] = [];
  const code = runSyntaxCheck([root], {
    stdout: (text) => lines.push(text),
    stderr: () => {},
  });
  const output = lines.join("");
  assert.equal(code, 1);
  assert.match(output, /syntax\./);
  assert.doesNotMatch(output, /cardinality\./);
  assert.match(output, /files: 1  syntax: [1-9]/);
});

test("runSyntaxCheck exits 0 when the sources parse", () => {
  const root = mkdtempSync(join(tmpdir(), "todl-syntax-"));
  writeFileSync(join(root, "model.todl"), CONCEPTS);
  const lines: string[] = [];
  const code = runSyntaxCheck([root], {
    stdout: (text) => lines.push(text),
    stderr: () => {},
  });
  assert.equal(code, 0);
  assert.equal(lines.join(""), "files: 1  syntax: 0\n");
});

test("runSyntaxCheck rejects missing arguments and paths", () => {
  const missing: string[] = [];
  assert.equal(runSyntaxCheck([], { stdout: () => {}, stderr: (text) => missing.push(text) }), 2);
  assert.match(missing.join(""), /usage: todl-syntax-checker/);
  const errors: string[] = [];
  assert.equal(runSyntaxCheck(["/no/such/todl-path"], {
    stdout: () => {},
    stderr: (text) => errors.push(text),
  }), 2);
  assert.match(errors.join(""), /cannot read/);
});

function run(argv: string[]): { code: number; out: string; err: string }
{
  const out: string[] = [];
  const err: string[] = [];
  const code = runSyntaxCheck(argv, { stdout: (text) => out.push(text), stderr: (text) => err.push(text) });
  return { code, out: out.join(""), err: err.join("") };
}

test("--help prints the usage to stdout and exits 0", () => {
  for (const flag of ["--help", "-h"])
  {
    const { code, out, err } = run([flag]);
    assert.equal(code, 0);
    assert.match(out, /usage: todl-syntax-checker/);
    assert.match(out, /exit codes:/);
    assert.equal(err, "");
  }
});

test("--version prints the package version and exits 0", () => {
  const manifest = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { version: string };
  for (const flag of ["--version", "-v"])
  {
    const { code, out } = run([flag]);
    assert.equal(code, 0);
    assert.equal(out, `${manifest.version}\n`);
  }
});

test("an unknown option is rejected, not read as a path", () => {
  const { code, out, err } = run(["--strict", "model.todl"]);
  assert.equal(code, 2);
  assert.equal(out, "");
  assert.match(err, /unknown option --strict/);
  assert.doesNotMatch(err, /cannot read/);
});

test("-- ends the options, so a path may start with a dash", () => {
  const root = mkdtempSync(join(tmpdir(), "todl-syntax-"));
  const dashed = join(root, "-dashed");
  mkdirSync(dashed);
  writeFileSync(join(dashed, "model.todl"), CONCEPTS);
  const previous = process.cwd();
  process.chdir(root);
  try
  {
    const { code, out } = run(["--", "-dashed"]);
    assert.equal(code, 0);
    assert.equal(out, "files: 1  syntax: 0\n");
  }
  finally
  {
    process.chdir(previous);
  }
});

test("a file named directly and through its directory is checked once", () => {
  const root = mkdtempSync(join(tmpdir(), "todl-syntax-"));
  const file = join(root, "model.todl");
  writeFileSync(file, CONCEPTS);
  const { code, out } = run([file, root]);
  assert.equal(code, 0);
  assert.equal(out, "files: 1  syntax: 0\n");
  assert.deepEqual(uniquePaths([file, join(root, ".", "model.todl")]), [file]);
});

test("the directory search skips node_modules and hidden directories", () => {
  const root = mkdtempSync(join(tmpdir(), "todl-syntax-"));
  mkdirSync(join(root, "node_modules", "dep"), { recursive: true });
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, "model.todl"), CONCEPTS);
  writeFileSync(join(root, "node_modules", "dep", "bad.todl"), BAD);
  writeFileSync(join(root, ".git", "bad.todl"), BAD);
  assert.deepEqual(collectTodlPaths(root), [join(root, "model.todl")]);
  assert.deepEqual(collectTodlPaths(join(root, ".git")), [join(root, ".git", "bad.todl")]);
});
