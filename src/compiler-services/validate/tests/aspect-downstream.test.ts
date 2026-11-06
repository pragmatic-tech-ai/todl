import { test } from "node:test";
import assert from "node:assert/strict";

import { check } from "../../api.js";
import { Builder } from "../../model/builder.js";
import { Direction, EdgeKind } from "../../model/graph.js";
import { DiagnosticCode, Severity, type Diagnostic } from "../../diagnostics/diagnostic.js";
import { ManifestEmitter } from "../../emit/manifest.js";
import { MetaKind } from "../../model/kinds.js";
import type { Repository } from "../../model/model.js";

/** Downstream validation/emission must see aspects (final-review findings). */
class DownstreamHarness
{
  public static Check(body: string): { model: Repository; diagnostics: Diagnostic[] }
  {
    const r = check([{ uri: "t.todl", text: `namespace t {\n${body}\n}` }]);
    return { model: r.model, diagnostics: r.diagnostics };
  }

  public static Codes(body: string): DiagnosticCode[]
  {
    return DownstreamHarness.Check(body).diagnostics.map((d) => d.code);
  }

  public static Count(body: string, code: DiagnosticCode): number
  {
    return DownstreamHarness.Codes(body).filter((c) => c === code).length;
  }
}

// -- 1: derive suppresses required-missing; assigning a derived member is diagnosed --

test("a derived aspect member is not required-missing on an instance", () =>
{
  const body = `aspect has_c { region : string; }\nconcept booking : has_c { derive region = "x"; }\nbooking b1 { }`;
  assert.equal(DownstreamHarness.Count(body, DiagnosticCode.RequiredMissing), 0, JSON.stringify(DownstreamHarness.Codes(body)));
});

test("a member derived on a supertype is not required-missing on a subtype instance", () =>
{
  const body = `aspect has_c { region : string; }\nconcept booking : has_c { derive region = "x"; }\nconcept sub : booking { }\nsub s1 { }`;
  assert.equal(DownstreamHarness.Count(body, DiagnosticCode.RequiredMissing), 0);
});

test("a non-derived required aspect member is still required-missing", () =>
{
  const body = `aspect has_c { region : string; }\nconcept booking : has_c { }\nbooking b1 { }`;
  assert.equal(DownstreamHarness.Count(body, DiagnosticCode.RequiredMissing), 1);
});

test("assigning a value to a derived member is DerivedMemberAssigned", () =>
{
  const r = DownstreamHarness.Check(`aspect has_c { region : string; }\nconcept booking : has_c { derive region = "x"; }\nbooking b1 { region = "eu"; }`);
  const found = r.diagnostics.filter((d) => d.code === DiagnosticCode.DerivedMemberAssigned);
  assert.equal(found.length, 1);
  assert.equal(found[0]!.node, "t.b1");
});

// -- 2: member annotations hang off the member target, not the concept --------

class MemberAnnotationSource
{
  public static readonly Text = `annotation heat { level : number; }
aspect cs { region : string; relationship near -> loc?; }
concept loc { }
concept a : cs {
  annotate heat { level = 1; }
  member region { annotate heat { level = 3; } }
  member near { annotate heat { level = 4; } }
}`;
}

test("a member annotation is not an annotation of the concept itself", () =>
{
  const r = DownstreamHarness.Check(MemberAnnotationSource.Text);
  assert.deepEqual(r.diagnostics.filter((d) => d.severity === Severity.Error), []);
  assert.deepEqual(r.model.related("t.a", EdgeKind.Annotated, Direction.Out), ["t.a@t.heat"]);
  const manifest = new ManifestEmitter(r.model, "t", "1.0.0").emitManifest();
  const anns = manifest.concepts["t.a"]!.annotations;
  assert.equal(anns.length, 1);
  assert.equal(anns[0]!.args["level"], "1");
});

test("a member annotation is reachable from the member target like a relationship-member annotation", () =>
{
  const r = DownstreamHarness.Check(MemberAnnotationSource.Text);
  assert.deepEqual(r.model.related(Builder.MemberTargetId("t.a", "region"), EdgeKind.Annotated, Direction.Out), [`${Builder.MemberTargetId("t.a", "region")}@t.heat`]);
  assert.deepEqual(r.model.related(Builder.MemberTargetId("t.a", "near"), EdgeKind.Annotated, Direction.Out), [`${Builder.MemberTargetId("t.a", "near")}@t.heat`]);
  assert.equal(r.model.resolve(`${Builder.MemberTargetId("t.a", "region")}@t.heat`)?.attrs.get("level"), "3");
  assert.equal(r.model.resolve(`${Builder.MemberTargetId("t.a", "region")}@t.heat`)?.attrs.has("@appliesToMember"), false);
});

// -- 3: aspect invariants run on carriers and are emitted ----------------------

class InvariantSource
{
  public static readonly Text = `aspect tagged { tag : string?; invariant { predicate = this.tag != none; description = "tag must be set"; } }
concept thing : tagged { }
concept sub : thing { }
thing t1 { }
sub s1 { }
thing t2 { tag = "ok"; }`;
}

test("an invariant declared in an aspect runs on every carrier instance", () =>
{
  const r = DownstreamHarness.Check(InvariantSource.Text);
  const failed = r.diagnostics.filter((d) => d.code === DiagnosticCode.InvariantFailed).map((d) => d.node).sort();
  assert.deepEqual(failed, ["t.s1", "t.t1"]);
});

test("an aspect invariant is emitted on the concept that introduces the aspect", () =>
{
  const r = DownstreamHarness.Check(InvariantSource.Text);
  const manifest = new ManifestEmitter(r.model, "t", "1.0.0").emitManifest();
  assert.deepEqual(manifest.concepts["t.thing"]!.invariants, ["tag must be set"]);
  assert.deepEqual(manifest.concepts["t.sub"]!.invariants, []);
});

// -- 4: a relationship targeting an aspect accepts carriers --------------------

test("a relationship targeting an aspect accepts a carrier instance", () =>
{
  const body = `aspect placed { }\nconcept loc : placed { }\nconcept other { }\nconcept thing { relationship in -> placed; }\nloc l1 { }\nother o1 { }\nthing t1 { in = l1; }\nthing t2 { in = o1; }`;
  const r = DownstreamHarness.Check(body);
  const mismatches = r.diagnostics.filter((d) => d.code === DiagnosticCode.TargetTypeMismatch).map((d) => d.node);
  assert.deepEqual(mismatches, ["t.t2"]);
});

// -- 5: aspect members colliding with Element members ---------------------------

test("an aspect member named like an Element member is a collision even without the root rule", () =>
{
  const r = DownstreamHarness.Check(`aspect labelled { label : string; }\nconcept c : labelled { }`);
  const found = r.diagnostics.filter((d) => d.code === DiagnosticCode.MemberCollision);
  assert.equal(found.length, 1, JSON.stringify(r.diagnostics));
  assert.equal(found[0]!.node, "t.labelled");
});

// -- 6: member annotation targets must be inherited/contributed ------------------

test("a member annotation on an unknown member is MemberAnnotationTargetInvalid", () =>
{
  const body = `annotation heat { level : number; }\naspect cs { region : string; }\nconcept a : cs { member nope { annotate heat { level = 1; } } }`;
  assert.equal(DownstreamHarness.Count(body, DiagnosticCode.MemberAnnotationTargetInvalid), 1, JSON.stringify(DownstreamHarness.Codes(body)));
});

test("a member annotation on the concept's own member is MemberAnnotationTargetInvalid", () =>
{
  const body = `annotation heat { level : number; }\nconcept loc { }\nconcept a { x : string; relationship r -> loc; member x { annotate heat { level = 1; } } member r { annotate heat { level = 2; } } }`;
  assert.equal(DownstreamHarness.Count(body, DiagnosticCode.MemberAnnotationTargetInvalid), 2, JSON.stringify(DownstreamHarness.Codes(body)));
});

test("a member annotation on a parent-chain member is accepted", () =>
{
  const body = `annotation heat { level : number; }\nconcept p { x : string; }\nconcept a : p { member x { annotate heat { level = 1; } } }`;
  assert.equal(DownstreamHarness.Count(body, DiagnosticCode.MemberAnnotationTargetInvalid), 0);
});

// -- 7: duplicate derive ------------------------------------------------------------

test("two derive entries for the same member is DuplicateDerive", () =>
{
  const body = `aspect cs { region : string; }\nconcept a : cs { derive region = "x"; derive region = "y"; }`;
  assert.equal(DownstreamHarness.Count(body, DiagnosticCode.DuplicateDerive), 1, JSON.stringify(DownstreamHarness.Codes(body)));
});

// -- 10: DerivesOf validates the parsed shape -------------------------------------

test("DerivesOf rejects valid JSON of the wrong shape", () =>
{
  const r = DownstreamHarness.Check(`concept c { }`);
  for (const bad of [`{"member":"x"}`, `[{"member":1,"expression":"x"}]`, `[{"member":"x"}]`, `[null]`])
  {
    r.model.setAttr("t.c", Builder.DerivesAttr, bad);
    assert.throws(() => r.model.DerivesOf("t.c"), /Malformed derives attribute/, bad);
  }
});

// -- re-review 1: member-target ids cannot collide with declared nodes ---------------

test("a member annotation never hangs off an unrelated node spelled <owner>.<member>", () =>
{
  const r = check([
    { uri: "t.todl", text: `namespace t {\nannotation heat { level : number; }\naspect cs { region : string; }\nconcept a : cs { member region { annotate heat { level = 3; } } }\n}` },
    { uri: "ta.todl", text: `namespace t.a {\nconcept region { }\n}` },
  ]);
  assert.equal(r.model.resolve("t.a.region")?.metaKind, MetaKind.Concept);
  assert.deepEqual(r.model.related("t.a.region", EdgeKind.Annotated, Direction.Out), []);
  const target = Builder.MemberTargetId("t.a", "region");
  assert.equal(r.model.resolve(target)?.metaKind, MetaKind.MemberTarget);
  const apps = r.model.related(target, EdgeKind.Annotated, Direction.Out);
  assert.equal(apps.length, 1);
  assert.equal(r.model.resolve(apps[0]!)?.attrs.get("level"), "3");
});

// -- re-review 2: only valid (aspect-contributed) derives count as derived -----------

test("an invalid derive does not suppress required-missing nor cascade DerivedMemberAssigned", () =>
{
  const own = DownstreamHarness.Codes(`concept c { y : string; derive y = 1; }\nc c1 { }\nc c2 { y = "v"; }`);
  assert.equal(own.filter((c) => c === DiagnosticCode.RequiredMissing).length, 1, JSON.stringify(own));
  assert.equal(own.filter((c) => c === DiagnosticCode.DerivedMemberAssigned).length, 0);
  const parent = DownstreamHarness.Codes(`concept p { x : string; }\nconcept c : p { derive x = 1; }\nc c1 { }\nc c2 { x = "v"; }`);
  assert.equal(parent.filter((c) => c === DiagnosticCode.RequiredMissing).length, 1, JSON.stringify(parent));
  assert.equal(parent.filter((c) => c === DiagnosticCode.DerivedMemberAssigned).length, 0);
});
