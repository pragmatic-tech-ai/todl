import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../parser.js";
import { DeclKind, type AspectDecl, type ConceptDecl } from "../ast.js";
import { TokenKind } from "../lexer.js";

class AspectParseHarness
{
  public static Decls(text: string)
  {
    const { namespace, diagnostics } = parse(text, "t.todl");
    assert.deepEqual(diagnostics, [], "no parse diagnostics");
    return namespace.declarations;
  }

  public static Concept(text: string): ConceptDecl
  {
    return AspectParseHarness.Decls(text).find((d) => d.kind === DeclKind.Concept) as ConceptDecl;
  }
}

test("aspect with one relationship", () =>
{
  const d = AspectParseHarness.Decls(`namespace t { aspect placed { relationship in -> location?; } }`)[0] as AspectDecl;
  assert.equal(d.kind, DeclKind.Aspect);
  assert.equal(d.name, "placed");
  assert.equal(d.relationships.length, 1);
  assert.deepEqual(d.includes, []);
});

test("aspect include list", () =>
{
  const d = AspectParseHarness.Decls(`namespace t { aspect cloud_scoped : placed { region : string?; } }`)[0] as AspectDecl;
  assert.deepEqual(d.includes.map((b) => b.name), ["placed"]);
  assert.equal(d.fields.length, 1);
});

test("concept base list keeps extends as first base", () =>
{
  const c = AspectParseHarness.Concept(`namespace t { concept network : base_net, cloud_scoped, tagged { } }`);
  assert.deepEqual(c.bases.map((b) => b.name), ["base_net", "cloud_scoped", "tagged"]);
  assert.equal(c.extends, "base_net");
});

test("concept without bases", () =>
{
  const c = AspectParseHarness.Concept(`namespace t { concept x { } }`);
  assert.deepEqual(c.bases, []);
  assert.equal(c.extends, null);
  assert.deepEqual(c.derives, []);
  assert.deepEqual(c.memberAnnotations, []);
});

test("derive captures tokens before the semicolon", () =>
{
  const c = AspectParseHarness.Concept(`namespace t { concept x { derive commitment = earliest(x); } }`);
  assert.equal(c.derives.length, 1);
  assert.equal(c.derives[0]!.member, "commitment");
  assert.equal(c.derives[0]!.expression.map((t) => t.value).join(""), "earliest(x)");
  assert.ok(c.derives[0]!.expression.every((t) => t.kind !== TokenKind.Semicolon));
});

test("member block carries annotations", () =>
{
  const c = AspectParseHarness.Concept(`namespace t { concept x { member commitment { annotate label { text = "Committed delivery date"; } } } }`);
  assert.equal(c.memberAnnotations.length, 1);
  assert.equal(c.memberAnnotations[0]!.member, "commitment");
  assert.equal(c.memberAnnotations[0]!.annotations.length, 1);
});

test("fields named member and derive still parse", () =>
{
  const c = AspectParseHarness.Concept(`namespace t { concept x { member : string; derive : string; } }`);
  assert.deepEqual(c.fields.map((f) => f.name), ["member", "derive"]);
  assert.deepEqual(c.memberAnnotations, []);
});
