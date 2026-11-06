import { test } from "node:test";
import assert from "node:assert/strict";

import { load } from "../../parse/loader.js";
import { check } from "../../api.js";
import { Builder } from "../builder.js";
import { EdgeKind } from "../graph.js";
import { Severity, DiagnosticCode } from "../../diagnostics/diagnostic.js";
import type { Repository } from "../model.js";

class AspectSchemaHarness
{
  public static readonly Source = `
concept loc { }
aspect placed { relationship in -> loc?; }
aspect cloud_scoped : placed { region : string; }
concept base_net { name : string; }
concept network : base_net, cloud_scoped { }
concept sub : network { }
concept unrelated { }
concept both : placed, cloud_scoped { }
network n1 { name = "a"; region = "eu"; }
sub s1 { name = "b"; region = "us"; }
unrelated u1 { }
`;

  public static Model(body: string = AspectSchemaHarness.Source): Repository
  {
    return load([{ uri: "t.todl", text: `namespace t {\n${body}\n}` }]).model;
  }

  public static Sorted(ids: string[]): string[]
  {
    return [...ids].sort();
  }
}

test("effective schema carries declaredBy per member, aspects contribute members", () =>
{
  const m = AspectSchemaHarness.Model();
  const schema = m.effectiveSchema("t.network");
  const region = schema.fields.find((f) => f.name === "region");
  const name = schema.fields.find((f) => f.name === "name");
  const inRel = schema.relationships.find((r) => r.name === "in");
  assert.equal(region?.declaredBy, "t.cloud_scoped");
  assert.equal(name?.declaredBy, "t.base_net");
  assert.equal(inRel?.declaredBy, "t.placed");
});

test("own, then supertypes, then aspects ordering", () =>
{
  const m = AspectSchemaHarness.Model();
  assert.deepEqual(m.effectiveSchema("t.network").fields.map((f) => f.name), ["name", "region"]);
});

test("a name from two sources keeps the first by ordering", () =>
{
  const m = AspectSchemaHarness.Model(`aspect a1 { x : string; }\nconcept base { x : integer; }\nconcept c : base, a1 { }`);
  const x = m.effectiveSchema("t.c").fields.filter((f) => f.name === "x");
  assert.equal(x.length, 1);
  assert.equal(x[0]?.declaredBy, "t.base");
});

test("AspectsOf: own, inherited and transitively included, each once", () =>
{
  const m = AspectSchemaHarness.Model();
  assert.deepEqual(AspectSchemaHarness.Sorted(m.AspectsOf("t.network")), ["t.cloud_scoped", "t.placed"]);
  assert.deepEqual(AspectSchemaHarness.Sorted(m.AspectsOf("t.sub")), ["t.cloud_scoped", "t.placed"]);
  assert.deepEqual(m.AspectsOf("t.unrelated"), []);
});

test("concept including placed directly and via cloud_scoped lists `in` once", () =>
{
  const m = AspectSchemaHarness.Model();
  assert.deepEqual(AspectSchemaHarness.Sorted(m.AspectsOf("t.both")), ["t.cloud_scoped", "t.placed"]);
  const rels = m.effectiveSchema("t.both").relationships.filter((r) => r.name === "in");
  assert.equal(rels.length, 1);
  assert.equal(rels[0]?.declaredBy, "t.placed");
});

test("CarriersOf lists concepts and subtypes carrying the aspect", () =>
{
  const m = AspectSchemaHarness.Model();
  assert.deepEqual(AspectSchemaHarness.Sorted(m.CarriersOf("t.placed")), ["t.both", "t.network", "t.sub"]);
  assert.deepEqual(AspectSchemaHarness.Sorted(m.CarriersOf("t.cloud_scoped")), ["t.both", "t.network", "t.sub"]);
});

test("IsA: self, supertype, carried aspect", () =>
{
  const m = AspectSchemaHarness.Model();
  assert.equal(m.IsA("t.sub", "t.placed"), true);
  assert.equal(m.IsA("t.sub", "t.sub"), true);
  assert.equal(m.IsA("t.sub", "t.base_net"), true);
  assert.equal(m.IsA("t.unrelated", "t.placed"), false);
  assert.equal(m.IsA("t.base_net", "t.network"), false);
});

test("InstancesMatching returns instances of every matching type", () =>
{
  const m = AspectSchemaHarness.Model();
  assert.deepEqual(AspectSchemaHarness.Sorted(m.InstancesMatching("t.placed").map((n) => n.id)), ["t.n1", "t.s1"]);
  assert.deepEqual(AspectSchemaHarness.Sorted(m.InstancesMatching("t.base_net").map((n) => n.id)), ["t.n1", "t.s1"]);
  assert.deepEqual(m.InstancesMatching("t.unrelated").map((n) => n.id), ["t.u1"]);
});

test("DerivesOf returns the concept's derive entries", () =>
{
  const m = AspectSchemaHarness.Model(`aspect cs { region : string; }\nconcept a : cs { derive region = upper( "x" ); }\nconcept b { }`);
  assert.deepEqual(m.DerivesOf("t.a"), [{ member: "region", expression: 'upper( "x" )' }]);
  assert.deepEqual(m.DerivesOf("t.b"), []);
});

test("queries terminate on cyclic extends and aspect inclusion", () =>
{
  const m = AspectSchemaHarness.Model();
  m.addEdge({ kind: EdgeKind.Extends, via: null, from: "t.base_net", to: "t.sub" });
  m.addEdge({ kind: EdgeKind.IncludesAspect, via: null, from: "t.placed", to: "t.cloud_scoped" });
  assert.ok(m.AspectsOf("t.network").length >= 2);
  assert.ok(m.CarriersOf("t.placed").length >= 3);
  assert.equal(m.IsA("t.sub", "t.placed"), true);
  assert.equal(m.IsA("t.unrelated", "t.placed"), false);
  assert.ok(m.InstancesMatching("t.placed").length >= 2);
  assert.ok(m.effectiveSchema("t.network").fields.length >= 2);
});

test("AppliesToMemberAttr is a key no identifier can spell", () =>
{
  assert.match(Builder.AppliesToMemberAttr, /^[^A-Za-z_]/);
});

test("a user annotation parameter named appliesToMember works on a member annotation", () =>
{
  const { diagnostics } = check([{ uri: "t.todl", text: `namespace t {
    annotation heat { appliesToMember : number; }
    aspect cs { region : string; }
    concept a : cs { member region { annotate heat { appliesToMember = 3; } } }
  }` }]);
  assert.deepEqual(diagnostics.filter((d) => d.severity === Severity.Error), []);
});

test("an undeclared appliesToMember on a normal annotation is annotation.unknown-param", () =>
{
  const { diagnostics } = check([{ uri: "t.todl", text: `namespace t {
    annotation heat { level : number; }
    concept a { annotate heat { level = 1; appliesToMember = 2; } }
  }` }]);
  const codes = diagnostics.filter((d) => d.severity === Severity.Error).map((d) => d.code);
  assert.ok(codes.includes(DiagnosticCode.AnnotationUnknownParam), JSON.stringify(diagnostics));
});

test("aspect queries reflect model mutation (cache invalidation)", () =>
{
  const m = AspectSchemaHarness.Model();
  assert.deepEqual(m.AspectsOf("t.unrelated"), []);
  assert.equal(m.IsA("t.unrelated", "t.placed"), false);
  assert.equal(m.CarriersOf("t.placed").includes("t.unrelated"), false);
  m.addEdge({ kind: EdgeKind.IncludesAspect, via: null, from: "t.unrelated", to: "t.placed" });
  assert.deepEqual(m.AspectsOf("t.unrelated"), ["t.placed"]);
  assert.equal(m.IsA("t.unrelated", "t.placed"), true);
  assert.equal(m.CarriersOf("t.placed").includes("t.unrelated"), true);
});

test("DerivesOf throws a clear error on a malformed derives attribute", () =>
{
  const m = AspectSchemaHarness.Model();
  m.setAttr("t.unrelated", Builder.DerivesAttr, "{not json");
  assert.throws(() => m.DerivesOf("t.unrelated"), /Malformed derives attribute on concept "t.unrelated"/);
});
