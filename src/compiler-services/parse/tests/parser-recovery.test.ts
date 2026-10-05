import { test } from "node:test";
import assert from "node:assert/strict";

import { parse } from "../parser.js";
import { DeclKind } from "../ast.js";

const SRC = `namespace demo {
  concept GoodA { label : string; }
  concept @@@ { }
  concept GoodB { label : string; }
}`;

test("parse recovers past a broken declaration and reports it", () => {
  const { namespace, diagnostics } = parse(SRC, "demo.todl");
  // Both well-formed concepts survived recovery.
  const names = namespace.declarations
    .filter((d) => d.kind === DeclKind.Concept)
    .map((d) => (d.kind === DeclKind.Concept ? d.name : ""));
  assert.deepEqual(names, ["GoodA", "GoodB"]);
  // The broken one produced at least one spanned syntax diagnostic.
  assert.ok(diagnostics.length >= 1);
  assert.equal(diagnostics[0]?.span?.uri, "demo.todl");
  assert.ok(diagnostics[0]?.code.startsWith("syntax."));
});

test("a member error inside a concept body recovers and later members + declarations still parse (#11)", () => {
  const src = `namespace acme
{
    concept Role
    {
        label : string;
        relationship on-unavailable -> Role;
        invariant "First rule.";
        invariant "Second rule.";
    }
    concept Good { label : string; }
}`;
  const { namespace, diagnostics } = parse(src, "t.todl");
  // The only syntax error is the hyphenated relationship name; the two valid
  // invariants are NOT reported (no cascade), and `Good` after it parses.
  const names = namespace.declarations
    .filter((d) => d.kind === DeclKind.Concept)
    .map((d) => (d.kind === DeclKind.Concept ? d.name : ""));
  assert.ok(names.includes("Role") && names.includes("Good"));
  const syntax = diagnostics.filter((d) => d.code.startsWith("syntax."));
  assert.equal(syntax.length, 1, `expected one syntax diagnostic, got ${syntax.map((d) => d.message).join(" | ")}`);
});

test("an error inside a taxonomy term body does not swallow later declarations (#11)", () => {
  const src = `namespace acme
{
    taxonomy Kind : represents Thing
    {
        term ai-agent { label = "AI agent"; }
    }
    concept Thing { label : string; }
    concept Second { label : string; }
}`;
  const { namespace, diagnostics } = parse(src, "t.todl");
  const names = namespace.declarations
    .filter((d) => d.kind === DeclKind.Concept)
    .map((d) => (d.kind === DeclKind.Concept ? d.name : ""));
  // Both concepts after the broken taxonomy term survive.
  assert.ok(names.includes("Thing") && names.includes("Second"));
  // One syntax error (the hyphen in the term id), not a cascade.
  assert.equal(diagnostics.filter((d) => d.code.startsWith("syntax.")).length, 1);
});
