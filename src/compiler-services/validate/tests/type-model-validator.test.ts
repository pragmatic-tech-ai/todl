import { test } from "node:test";
import assert from "node:assert/strict";

import { load } from "../../parse/loader.js";
import { EdgeKind } from "../../model/graph.js";
import { DiagnosticCode, type Diagnostic } from "../../diagnostics/diagnostic.js";
import { validate } from "../validate.js";
import { TypeModelValidator } from "../type-model-validator.js";
import type { Repository } from "../../model/model.js";

class TypeModelHarness
{
  public static Model(body: string): Repository
  {
    return load([{ uri: "t.todl", text: `namespace t {\n${body}\n}` }]).model;
  }

  public static Run(model: Repository, enforceRoot = false): Diagnostic[]
  {
    return new TypeModelValidator(model, { EnforceRootMemberRule: enforceRoot }).Validate();
  }

  public static Codes(body: string): DiagnosticCode[]
  {
    return TypeModelHarness.Run(TypeModelHarness.Model(body)).map((d) => d.code);
  }
}

const H = TypeModelHarness;

test("redeclaring a parent member is MemberRedeclared with the member span", () =>
{
  const m = H.Model(`concept p { x : string; }\nconcept c : p { x : string; }`);
  const found = H.Run(m).filter((d) => d.code === DiagnosticCode.MemberRedeclared);
  assert.equal(found.length, 1);
  assert.equal(found[0]!.node, "t.c");
  assert.equal(found[0]!.span?.uri, "t.todl");
});

test("redeclaring an aspect-provided member is MemberRedeclared", () =>
{
  assert.deepEqual(H.Codes(`aspect a { region : string; }\nconcept c : a { region : string; }`), [DiagnosticCode.MemberRedeclared]);
});

test("a member shared with Element is flagged only when EnforceRootMemberRule is true", () =>
{
  const m = H.Model(`concept c { label : string; }`);
  m.builder().defineConcept("todl.Element").addField("todl.Element", "label", "string").commit();
  assert.equal(H.Run(m, false).length, 0);
  assert.equal(H.Run(m, true).some((d) => d.code === DiagnosticCode.MemberRedeclared), true);
});

test("two aspects contributing the same member is one MemberCollision", () =>
{
  const codes = H.Codes(`aspect a { region : string; }\naspect b { region : string; }\nconcept c : a, b { }\nconcept d : c { }`);
  assert.deepEqual(codes, [DiagnosticCode.MemberCollision]);
});

test("an aspect and the parent chain providing the same member collide", () =>
{
  assert.deepEqual(H.Codes(`aspect a { x : string; }\nconcept p { x : string; }\nconcept c : p, a { }`), [DiagnosticCode.MemberCollision]);
});

test("collision inside an aspect's include closure is reported on the aspect", () =>
{
  const m = H.Model(`aspect a { x : string; }\naspect b { x : string; }\naspect top : a, b { }`);
  const found = H.Run(m);
  assert.deepEqual(found.map((d) => d.code), [DiagnosticCode.MemberCollision]);
  assert.equal(found[0]!.node, "t.top");
});

test("the same aspect via two paths is not a collision", () =>
{
  assert.deepEqual(H.Codes(`aspect base { x : string; }\naspect mid : base { }\nconcept c : base, mid { }`), []);
});

test("an instance whose type is an aspect is AspectNotInstantiable", () =>
{
  const m = H.Model(`aspect a { x : string; }`);
  m.builder().assertInstance("t.a", "t.inst").commit();
  const found = H.Run(m).filter((d) => d.code === DiagnosticCode.AspectNotInstantiable);
  assert.equal(found.length, 1);
  assert.equal(found[0]!.node, "t.inst");
});

test("derive of an aspect-contributed member is accepted", () =>
{
  assert.deepEqual(H.Codes(`aspect a { x : string; }\nconcept c : a { derive x = 1; }`), []);
});

test("derive of an own or unknown member is DeriveTargetNotContributed", () =>
{
  assert.deepEqual(H.Codes(`concept c { y : string; derive y = 1; }`), [DiagnosticCode.DeriveTargetNotContributed]);
  const m = H.Model(`aspect a { x : string; }\nconcept c : a { derive nope = 1; }`);
  const found = H.Run(m);
  assert.deepEqual(found.map((d) => d.code), [DiagnosticCode.DeriveTargetNotContributed]);
  assert.equal(found[0]!.span?.uri, "t.todl");
});

test("derive of a parent-chain member is DeriveTargetNotContributed", () =>
{
  assert.deepEqual(H.Codes(`concept p { x : string; }\nconcept c : p { derive x = 1; }`), [DiagnosticCode.DeriveTargetNotContributed]);
});

test("an Extends cycle is one InheritanceCycle and terminates", () =>
{
  const codes = H.Codes(`concept a : b { }\nconcept b : a { }`);
  assert.deepEqual(codes.filter((c) => c === DiagnosticCode.InheritanceCycle), [DiagnosticCode.InheritanceCycle]);
});

test("an aspect include cycle is one InheritanceCycle and terminates", () =>
{
  const codes = H.Codes(`aspect p : q { }\naspect q : p { }`);
  assert.deepEqual(codes.filter((c) => c === DiagnosticCode.InheritanceCycle), [DiagnosticCode.InheritanceCycle]);
});

test("two Extends edges on one concept is MultipleExtendsEdges", () =>
{
  const m = H.Model(`concept p1 { }\nconcept p2 { }\nconcept c : p1 { }`);
  m.addEdge({ kind: EdgeKind.Extends, via: null, from: "t.c", to: "t.p2" });
  assert.equal(H.Run(m).some((d) => d.code === DiagnosticCode.MultipleExtendsEdges), true);
});

test("validate() reports type-model diagnostics once and terminates on a cycle", () =>
{
  const m = H.Model(`concept a : b { }\nconcept b : a { }\naspect g { r : string; }\naspect h { r : string; }\nconcept c : g, h { }`);
  const codes = validate(m).map((d) => d.code);
  assert.equal(codes.filter((c) => c === DiagnosticCode.InheritanceCycle).length, 1);
  assert.equal(codes.filter((c) => c === DiagnosticCode.MemberCollision).length, 1);
});
