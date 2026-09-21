import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Graph, Tier, EdgeKind, Direction, type Node } from "../graph.js";
import { MetaKind } from "../kinds.js";
import { Repository } from "../model.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";
import { toJSON, fromJSON } from "../../emit/json.js";

/** A fully-formed node literal — the reshape gives every node the same root shape. */
function node(partial: Partial<Node> & Pick<Node, "id" | "tier">): Node
{
  return {
    type: null,
    metaKind: null,
    namespace: null,
    localId: null,
    isClass: false,
    class: null,
    storageId: null,
    fields: [],
    attrs: new Map(),
    ...partial,
  };
}

describe("SPEC-01: the typeOf split (type vs metaKind)", () => {
  test("an ontology declaration carries metaKind, not type", () => {
    const repo = new Repository();
    repo.builder().defineConcept("Component").commit();
    const c = repo.resolve("Component")!;
    assert.equal(c.metaKind, MetaKind.Concept);
    assert.equal(c.type, null);
  });

  test("an instance carries type (its concept), not metaKind", () => {
    const repo = new Repository();
    repo.builder().defineConcept("Component").assertInstance("Component", "web").commit();
    const web = repo.resolve("web")!;
    assert.equal(web.type, "Component");
    assert.equal(web.metaKind, null);
  });

  test("instancesOf keys on type; nodesOfMetaKind keys on metaKind", () => {
    const repo = new Repository();
    repo.builder().defineConcept("Component").assertInstance("Component", "web").assertInstance("Component", "api").commit();
    assert.deepEqual(repo.instancesOf("Component").sort(), ["api", "web"]);
    assert.deepEqual(repo.nodesOfMetaKind(MetaKind.Concept), ["Component"]);
    // The old overload — instancesOf(<meta-kind sentinel>) — no longer returns declarations.
    assert.deepEqual(repo.instancesOf(MetaKind.Concept), []);
  });
});

describe("SPEC-01: a taxonomy term is dual (type + metaKind) with clean attrs", () => {
  function paletteRepo(): Repository
  {
    const repo = new Repository();
    repo
      .builder()
      .setNamespace("shop")
      .defineConcept("Color")
      .defineTaxonomy("Palette", ["Color"], [{ id: "Surface", attrs: new Map([["hex", "#eee"]]) }])
      .commit();
    return repo;
  }

  test("term node exposes metaKind=Term, isClass, localId, type=concept", () => {
    const term = paletteRepo().resolve("Palette.Surface")!;
    assert.equal(term.metaKind, MetaKind.Term);
    assert.equal(term.isClass, true);
    assert.equal(term.localId, "Surface");
    assert.equal(term.type, "Color");
    assert.equal(term.namespace, "shop");
  });

  test("term attrs hold ONLY user data — no class/id/namespace markers", () => {
    const term = paletteRepo().resolve("Palette.Surface")!;
    assert.deepEqual([...term.attrs.keys()], ["hex"]);
    assert.equal(term.attrs.has("class"), false);
    assert.equal(term.attrs.has("id"), false);
    assert.equal(term.attrs.has("namespace"), false);
  });
});

describe("SPEC-01: effectiveFields overlay has no marker blocklist (#5, #6)", () => {
  test("a user attr literally named `class` or `id` survives the class overlay", () => {
    const repo = new Repository();
    const b = repo.builder();
    b.defineConcept("C");
    b.assertInstance("C", "base", true); // a class
    b.setField("base", "tier", "gold");
    b.setField("base", "id", "BASE"); // genuine USER attr named `id` — no longer a marker
    b.assertInstance("C", "leaf");
    b.addInstanceOf("leaf", "base");
    b.setField("leaf", "class", true); // genuine USER attr named `class`
    b.commit();

    const eff = repo.effectiveFields("leaf");
    // The old blocklist (key !== "class" && key !== "id") would have dropped these.
    assert.equal(eff.get("class"), true); // leaf's own user attr
    assert.equal(eff.get("id"), "BASE"); // inherited from the class
    assert.equal(eff.get("tier"), "gold"); // ordinary inherited fixed value
    // Structural class-ness is the ROOT field, decoupled from the `class` attr.
    assert.equal(repo.isClass("leaf"), false);
    assert.equal(repo.isClass("base"), true);
  });
});

describe("SPEC-01 #6: Contains target must be a term (enforceable)", () => {
  test("a Contains edge to a non-term node is diagnosed; a real term is accepted", () => {
    const repo = new Repository();
    const b = repo.builder();
    b.defineConcept("Color");
    b.defineTaxonomy("Palette", ["Color"], [{ id: "Surface" }]);
    b.assertInstance("Color", "notATerm");
    b.addContains("Palette", "notATerm"); // illegal: not a term
    b.commit();

    const codes = repo.validate().map((d) => ({ code: d.code, node: d.node }));
    assert.ok(
      codes.some((d) => d.code === DiagnosticCode.ContainsTargetNotTerm && d.node === "notATerm"),
      "non-term Contains target is flagged",
    );
    // The genuine term is NOT flagged.
    assert.ok(
      !codes.some((d) => d.code === DiagnosticCode.ContainsTargetNotTerm && d.node === "Palette.Surface"),
      "the real term is accepted",
    );
    // Sanity: the term truly carries metaKind Term and sits under Contains.
    assert.equal(repo.resolve("Palette.Surface")!.metaKind, MetaKind.Term);
    assert.ok(repo.related("Palette", EdgeKind.Contains, Direction.Out).includes("Palette.Surface"));
  });
});

describe("SPEC-01 #3: storageId is a reserved slot that round-trips", () => {
  test("a node's storageId survives JSON round-trip (no semantics asserted)", () => {
    const g = new Graph();
    g.addNode(node({ id: "n1", tier: Tier.Instance, type: "C", storageId: "blob-7" }));
    const restored = fromJSON(toJSON(new Repository(g)));
    assert.equal(restored.resolve("n1")!.storageId, "blob-7");
  });
});

describe("SPEC-01: JSON round-trip is identity across the new root fields", () => {
  test("type/metaKind/namespace/localId/isClass/class all survive toJSON→fromJSON", () => {
    const repo = new Repository();
    repo
      .builder()
      .setNamespace("shop")
      .defineConcept("Color")
      .defineTaxonomy("Palette", ["Color"], [{ id: "Surface", attrs: new Map([["hex", "#eee"]]) }])
      .assertInstance("Color", "brand")
      .commit();

    const restored = fromJSON(toJSON(repo));
    for (const id of ["Color", "Palette", "Palette.Surface", "brand"])
    {
      const before = repo.resolve(id)!;
      const after = restored.resolve(id)!;
      assert.equal(after.type, before.type, `${id}.type`);
      assert.equal(after.metaKind, before.metaKind, `${id}.metaKind`);
      assert.equal(after.namespace, before.namespace, `${id}.namespace`);
      assert.equal(after.localId, before.localId, `${id}.localId`);
      assert.equal(after.isClass, before.isClass, `${id}.isClass`);
      assert.deepEqual([...after.attrs], [...before.attrs], `${id}.attrs`);
    }
  });
});
