import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../api.js";
import { DiagnosticCode, Severity } from "../../diagnostics/diagnostic.js";

function diags(text: string)
{
  return check([{ uri: "a.todl", text }]).diagnostics;
}

function codes(text: string): DiagnosticCode[]
{
  return diags(text).map((d) => d.code);
}

// ── #4 integer / numeric type checking ────────────────────────────────────────

test("an integer field accepting an integer literal compiles clean", () => {
  assert.deepEqual(codes(`namespace demo
  {
    concept rule { priority : integer; }
    model m : demo { rule ok { priority = 1; } }
  }`), []);
});

test("a string on an integer field is type.value-invalid (#4)", () => {
  assert.ok(codes(`namespace demo
  {
    concept rule { priority : integer; }
    model m : demo { rule bad { priority = "high"; } }
  }`).includes(DiagnosticCode.ScalarValueInvalid));
});

test("a non-integer number on an integer field is type.value-invalid (#4)", () => {
  assert.ok(codes(`namespace demo
  {
    concept rule { priority : integer; }
    model m : demo { rule bad { priority = "1.5"; } }
  }`).includes(DiagnosticCode.ScalarValueInvalid));
});

// ── #3 primitive regex enforcement ────────────────────────────────────────────

test("a value matching the primitive regex compiles clean", () => {
  assert.deepEqual(codes(`namespace demo
  {
    primitive duration : string { regex = "[1-9][0-9]*(m|h|d|w)"; }
    concept timer { after : duration; }
    model m : demo { timer ok { after = "2d"; } }
  }`), []);
});

test("a value violating the primitive regex is type.regex-mismatch (#3)", () => {
  assert.ok(codes(`namespace demo
  {
    primitive duration : string { regex = "[1-9][0-9]*(m|h|d|w)"; }
    concept timer { after : duration; }
    model m : demo { timer bad { after = "someday"; } }
  }`).includes(DiagnosticCode.RegexMismatch));
});

// ── #5 unknown-member detection (warning) ─────────────────────────────────────

test("an assignment to an undeclared member warns member.unknown (#5)", () => {
  const ds = diags(`namespace demo
  {
    concept gateway { label : string; }
    model m : demo { gateway g { label = "G"; critical_x = 1; } }
  }`);
  const unknown = ds.find((d) => d.code === DiagnosticCode.MemberUnknown);
  assert.ok(unknown !== undefined, "expected a member.unknown diagnostic");
  assert.equal(unknown.severity, Severity.Warning);
});

test("a declared member does not warn", () => {
  assert.ok(!codes(`namespace demo
  {
    concept gateway { label : string; }
    model m : demo { gateway g { label = "G"; } }
  }`).includes(DiagnosticCode.MemberUnknown));
});
