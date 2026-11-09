import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../parser.js";
import { DeclKind, ValueKind, type InstanceDecl, type ModelDecl, type ObjectValue } from "../ast.js";

function model(text: string): ModelDecl
{
  const { namespace, diagnostics } = parse(text, "t.todl");
  assert.deepEqual(diagnostics, [], "expected no parse diagnostics");
  const decl = namespace.declarations.find((d) => d.kind === DeclKind.Model);
  assert.ok(decl, "expected a model");
  return decl as ModelDecl;
}

test("variant parses in an instance body, in source order, beside assignments", () => {
  const m = model(`namespace t {
    model m : t {
      report monthly {
        label = "Monthly report";
        variant "No capability consumes it.";
        variant "It has no owner.";
      }
    }
  }`);
  const inst = m.instances[0]!;
  assert.deepEqual(inst.variants.map((v) => v.text), ["No capability consumes it.", "It has no owner."]);
  assert.deepEqual(inst.assignments.map((a) => a.name), ["label"]);
  assert.ok(inst.variants[0]!.span.start.line > 0, "the variant carries its span");
});

test("variant parses in a nested record and in an inline object", () => {
  const m = model(`namespace t {
    model m : t {
      capability c {
        metric x { variant "Nobody reads it."; }
        owner = role { variant "Not staffed."; };
      }
    }
  }`);
  const cap = m.instances[0]!;
  assert.deepEqual((cap.children[0] as InstanceDecl).variants.map((v) => v.text), ["Nobody reads it."]);
  const inline = cap.assignments.find((a) => a.name === "owner")!.value as ObjectValue;
  assert.equal(inline.kind, ValueKind.Object);
  assert.deepEqual(inline.variants.map((v) => v.text), ["Not staffed."]);
});

test("a field or a concept named variant still parses as before", () => {
  const m = model(`namespace t {
    model m : t {
      product p {
        variant = "blue";
        variant v1 { label = "Blue"; }
      }
    }
  }`);
  const p = m.instances[0]!;
  assert.deepEqual(p.variants, []);
  assert.deepEqual(p.assignments.map((a) => a.name), ["variant"]);
  assert.equal(p.children[0]!.concept, "variant");
});

test("variant in a concept body is a syntax error that points to invariant", () => {
  const { diagnostics } = parse(`namespace t {
    concept c { variant "x"; }
  }`, "t.todl");
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0]!.message, /only in the body of an instance/);
});

test("variant in a model body, outside any instance, is a syntax error", () => {
  const { diagnostics } = parse(`namespace t {
    model m : t { variant "x"; }
  }`, "t.todl");
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0]!.message, /inside the body of the instance/);
});
