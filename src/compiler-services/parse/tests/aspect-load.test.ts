import { test } from "node:test";
import assert from "node:assert/strict";

import { load } from "../loader.js";
import { check } from "../../api.js";
import { Builder } from "../../model/builder.js";
import { MetaKind } from "../../model/kinds.js";
import { EdgeKind, Direction } from "../../model/graph.js";
import { Severity, DiagnosticCode } from "../../diagnostics/diagnostic.js";

class AspectLoadHarness
{
  public static Load(body: string, ns = "t")
  {
    return load([{ uri: "t.todl", text: `namespace ${ns} {\n${body}\n}` }]);
  }

  public static Errors(result: { diagnostics: { severity: Severity }[] })
  {
    return result.diagnostics.filter((d) => d.severity === Severity.Error);
  }

  public static Codes(result: { diagnostics: { code: DiagnosticCode }[] }): DiagnosticCode[]
  {
    return result.diagnostics.map((d) => d.code);
  }
}

const Base = `concept base_net { }
aspect cloud_scoped { region : string; }
aspect some_aspect { }`;

test("parent concept becomes Extends, aspect becomes IncludesAspect", () =>
{
  const r = AspectLoadHarness.Load(`${Base}\nconcept network : base_net, cloud_scoped { }`);
  assert.deepEqual(AspectLoadHarness.Errors(r), []);
  assert.deepEqual(r.model.related("t.network", EdgeKind.Extends, Direction.Out), ["t.base_net"]);
  assert.deepEqual(r.model.related("t.network", EdgeKind.IncludesAspect, Direction.Out), ["t.cloud_scoped"]);
  assert.equal(r.model.resolve("t.cloud_scoped")?.metaKind, MetaKind.Aspect);
});

test("aspect-only base list has no Extends edge and one IncludesAspect", () =>
{
  const r = AspectLoadHarness.Load(`${Base}\nconcept a : some_aspect { }`);
  assert.deepEqual(AspectLoadHarness.Errors(r), []);
  assert.deepEqual(r.model.related("t.a", EdgeKind.Extends, Direction.Out), []);
  assert.deepEqual(r.model.related("t.a", EdgeKind.IncludesAspect, Direction.Out), ["t.some_aspect"]);
});

test("concept after an aspect is ConceptBaseNotFirst", () =>
{
  const r = AspectLoadHarness.Load(`${Base}\nconcept a : some_aspect, base_net { }`);
  assert.deepEqual(AspectLoadHarness.Codes(r), [DiagnosticCode.ConceptBaseNotFirst]);
  // The misplaced concept is still staged as the parent so nothing cascades.
  assert.deepEqual(r.model.related("t.a", EdgeKind.Extends, Direction.Out), ["t.base_net"]);
  assert.deepEqual(r.model.related("t.a", EdgeKind.IncludesAspect, Direction.Out), ["t.some_aspect"]);
});

test("two concepts is MultipleParentConcepts", () =>
{
  const r = AspectLoadHarness.Load(`concept b { }\nconcept c { }\nconcept a : b, c { }`);
  assert.deepEqual(AspectLoadHarness.Codes(r), [DiagnosticCode.MultipleParentConcepts]);
  assert.deepEqual(r.model.related("t.a", EdgeKind.Extends, Direction.Out), ["t.b"]);
  assert.equal(r.model.related("t.a", EdgeKind.IncludesAspect, Direction.Out).length, 0);
});

test("aspect including a concept is AspectIncludesNonAspect", () =>
{
  const r = AspectLoadHarness.Load(`${Base}\naspect x : base_net { }`);
  assert.deepEqual(AspectLoadHarness.Codes(r), [DiagnosticCode.AspectIncludesNonAspect]);
  assert.deepEqual(r.model.related("t.x", EdgeKind.IncludesAspect, Direction.Out), []);
});

test("aspect includes aspect", () =>
{
  const r = AspectLoadHarness.Load(`${Base}\naspect x : some_aspect { }`);
  assert.deepEqual(AspectLoadHarness.Errors(r), []);
  assert.deepEqual(r.model.related("t.x", EdgeKind.IncludesAspect, Direction.Out), ["t.some_aspect"]);
});

test("unknown base keeps the reference.undefined path", () =>
{
  const r = AspectLoadHarness.Load(`concept a : nope { }`);
  assert.deepEqual(AspectLoadHarness.Codes(r), [DiagnosticCode.ReferenceUndefined]);
});

test("aspect fields and relationships are staged on the aspect node", () =>
{
  const r = AspectLoadHarness.Load(`concept loc { }\naspect placed { region : string; relationship in -> loc?; }`);
  assert.deepEqual(AspectLoadHarness.Errors(r), []);
  assert.equal(r.model.resolve("t.placed")?.fields?.[0]?.name, "region");
  assert.ok(r.model.resolve("t.placed.in"));
});

test("base names may be namespace-qualified across sources", () =>
{
  const r = load([
    { uri: "a.todl", text: `namespace ns { concept base_net { } aspect cs { } }` },
    { uri: "b.todl", text: `namespace t { concept a : ns.base_net, ns.cs { } }` },
  ]);
  assert.deepEqual(AspectLoadHarness.Errors(r), []);
  assert.deepEqual(r.model.related("t.a", EdgeKind.Extends, Direction.Out), ["ns.base_net"]);
  assert.deepEqual(r.model.related("t.a", EdgeKind.IncludesAspect, Direction.Out), ["ns.cs"]);
});

test("derive is stored as source text; member annotations hang off the member target", () =>
{
  const r = AspectLoadHarness.Load(
    `annotation heat { level : number; }\naspect cs { region : string; }\n` +
    `concept a : cs {\n  derive region = upper( "x" ) + y;\n  member region { annotate heat { level = 3; } }\n}`);
  assert.deepEqual(AspectLoadHarness.Errors(r), []);
  const derives = JSON.parse(String(r.model.resolve("t.a")?.attrs.get(Builder.DerivesAttr)));
  assert.deepEqual(derives, [{ member: "region", expression: 'upper( "x" ) + y' }]);
  const app = r.model.resolve(`${Builder.MemberTargetId("t.a", "region")}@t.heat`);
  assert.ok(app);
  assert.equal(app?.attrs.get("level"), "3");
  const target = r.model.resolve(Builder.MemberTargetId("t.a", "region"));
  assert.equal(target?.metaKind, MetaKind.MemberTarget);
  assert.equal(target?.attrs.get(Builder.MemberTargetNameAttr), "region");
  assert.deepEqual(r.model.related(Builder.MemberTargetId("t.a", "region"), EdgeKind.Annotated, Direction.Out), [`${Builder.MemberTargetId("t.a", "region")}@t.heat`]);
  assert.deepEqual(r.model.related("t.a", EdgeKind.Annotated, Direction.Out), []);
});

test("a non-concept non-aspect base after the first is reported as not an aspect", () =>
{
  const r = AspectLoadHarness.Load(`${Base}
primitive p { }
concept a : some_aspect, p { }`);
  const d = r.diagnostics.filter((x) => x.severity === Severity.Error);
  assert.equal(d.length, 1);
  assert.equal(d[0]!.code, DiagnosticCode.ConceptBaseNotFirst);
  assert.match(d[0]!.message, /not an aspect/);
  assert.doesNotMatch(d[0]!.message, /parent concept/);
});

test("a repeated base is deduplicated with a duplicate-base warning", () =>
{
  const r = AspectLoadHarness.Load(`${Base}
concept a : some_aspect, some_aspect { }`);
  assert.deepEqual(AspectLoadHarness.Codes(r), [DiagnosticCode.DuplicateBase]);
  assert.equal(r.diagnostics[0]!.severity, Severity.Warning);
  assert.deepEqual(r.model.related("t.a", EdgeKind.IncludesAspect, Direction.Out), ["t.some_aspect"]);
});

test("a duplicate member annotation message names the member", () =>
{
  const r = AspectLoadHarness.Load(
    `annotation heat { level : number; }
aspect cs { region : string; }
` +
    `concept a : cs { member region { annotate heat { level = 1; } annotate heat { level = 2; } } }`);
  const d = r.diagnostics.find((x) => x.code === DiagnosticCode.AnnotationDuplicate);
  assert.ok(d);
  assert.match(d!.message, /a\.region/);
});

test("check(): a member annotation compiles without annotation.unknown-param", () =>
{
  const { diagnostics } = check([{ uri: "t.todl", text: `namespace t {
    annotation heat { level : number; }
    aspect cs { region : string; }
    concept a : cs { member region { annotate heat { level = 3; } } }
  }` }]);
  assert.deepEqual(diagnostics.filter((d) => d.severity === Severity.Error), []);
});
