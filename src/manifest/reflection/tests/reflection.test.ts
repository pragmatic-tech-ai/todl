import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ManifestWriter } from "../../manifest-writer.js";
import { Manifest, TypeInfo, FieldInfo, TermInfo } from "../reflection.js";
import type { ReflectedNode } from "../reflection.js";
import type { LogicalManifest } from "../../logical.js";
import { Cardinality } from "../../enums.js";

// The SPEC-05 §5 "shop" model:
//   concept Element { name: string }
//   concept Component : Element { tier: string } + dependsOn -> Component (*, inverse usedBy)
//   taxonomy Layers represents Component; term Components.Surface : Component fixes tier = "ui".
function shopLogical(): LogicalManifest {
  return {
    format: "todl-manifest/1",
    model: "shop",
    version: "1.4.0",
    root: "Element",
    concepts: {
      Element: {
        extends: null,
        fields: { name: { type: "string", card: "1" } },
        relationships: {},
        invariants: [],
      },
      Component: {
        extends: "Element",
        fields: { tier: { type: "string", card: "1" } },
        relationships: { dependsOn: { targets: ["Component"], card: "*", inverse: "usedBy" } },
        invariants: [],
      },
    },
    classes: {
      "Components.Surface": {
        concept: "Component", taxonomy: "Layers", narrower: [], fixed: { tier: "ui" },
      },
    },
    taxonomies: { Layers: { represents: ["Component"], roots: ["Components.Surface"] } },
  };
}

function loadShop(binary = false): Manifest {
  const writer = ManifestWriter.fromLogical(shopLogical());
  return Manifest.load(binary ? writer.toBinary() : writer.toJSON());
}

const checkout: ReflectedNode = {
  id: "shop.checkout",
  type: "Component",
  class: "Components.Surface",
  namespace: "shop",
  attrs: { name: "Checkout" }, // tier NOT set → inherits "ui" from the class
  refs: { dependsOn: ["shop.cart"] },
};

describe("SPEC-05 t1-2: Manifest skeleton + handle identity", () => {
  test("model/version/root/types/getType", () => {
    const m = loadShop();
    assert.equal(m.model, "shop");
    assert.equal(m.version, "1.4.0");
    assert.equal(m.root().name, "Element");
    assert.ok(m.types().length >= 3); // Element, Component, string
    assert.equal(m.getType("Component")?.name, "Component");
    assert.equal(m.getType("nope"), undefined);
  });

  test("same token → equal handles (value identity)", () => {
    const m = loadShop();
    assert.equal(m.getType("Component")!.token, m.getType("Component")!.token);
    assert.notEqual(m.getType("Component")!.token, m.getType("Element")!.token);
  });
});

describe("SPEC-05 t3: TypeInfo core + baseType", () => {
  test("Component.baseType === Element; Element.baseType undefined", () => {
    const m = loadShop();
    assert.equal(m.getType("Component")!.baseType!.name, "Element");
    assert.equal(m.getType("Element")!.baseType, undefined);
  });
});

describe("SPEC-05 t4-5: FieldInfo + declared vs effective (Axis 1)", () => {
  test("getDeclaredFields is own-only", () => {
    const c = loadShop().getType("Component")!;
    assert.deepEqual(c.getDeclaredFields().map((f) => f.name), ["tier"]);
  });

  test("getFields is effective, subtype-first, carries declaringType (Axis 1)", () => {
    const c = loadShop().getType("Component")!;
    const fields = c.getFields();
    assert.deepEqual(fields.map((f) => f.name), ["tier", "name"]);
    const byName = (n: string) => fields.find((f) => f.name === n)!;
    assert.equal(byName("tier").declaringType.name, "Component");
    assert.equal(byName("name").declaringType.name, "Element"); // inherited
    assert.equal(byName("name").reflectedType.name, "Component"); // obtained through
  });

  test("FieldInfo type + cardinality", () => {
    const tier = loadShop().getType("Component")!.getField("tier")!;
    assert.equal(tier.fieldType!.name, "string");
    assert.equal(tier.cardinality, Cardinality.One);
  });
});

describe("SPEC-05 t6: subtype algebra", () => {
  test("isSubtypeOf / isAssignableFrom / getSupertypes", () => {
    const m = loadShop();
    const el = m.getType("Element")!;
    const co = m.getType("Component")!;
    assert.equal(co.isSubtypeOf(el), true);
    assert.equal(el.isSubtypeOf(co), false);
    assert.equal(co.isSubtypeOf(co), false); // strict
    assert.equal(el.isAssignableFrom(co), true);
    assert.equal(co.isAssignableFrom(co), true); // reflexive
    assert.equal(co.isAssignableFrom(el), false);
    assert.deepEqual(co.getSupertypes().map((t) => t.name), ["Element"]);
    assert.equal(co.isSubtypeOf(m.root()), true);
  });
});

describe("SPEC-05 t7: RelationshipInfo", () => {
  test("declared relationship carries targets, inverse, cardinality, getTargets", () => {
    const co = loadShop().getType("Component")!;
    const rels = co.getDeclaredRelationships();
    assert.deepEqual(rels.map((r) => r.name), ["dependsOn"]);
    const dep = rels[0]!;
    assert.deepEqual(dep.targets.map((t) => t.name), ["Component"]);
    assert.equal(dep.inverse, "usedBy");
    assert.equal(dep.cardinality, Cardinality.Many);
    assert.deepEqual(dep.getTargets(checkout), ["shop.cart"]);
    assert.equal(co.getMembers().length, 3); // tier, name, dependsOn
  });
});

describe("SPEC-05 t8: getValue (attrs + class-fixed fallback)", () => {
  test("own attr value, else class-fixed value", () => {
    const co = loadShop().getType("Component")!;
    assert.equal(co.getField("name")!.getValue(checkout), "Checkout"); // own attr
    assert.equal(co.getField("tier")!.getValue(checkout), "ui"); // class fixed fallback
    assert.equal(co.getField("tier")!.getValue({ ...checkout, class: null }), undefined);
  });
});

describe("SPEC-05 t9: TermInfo + TaxonomyInfo", () => {
  test("term concept/taxonomy/fixes/getFixedValue", () => {
    const m = loadShop();
    const term = m.getTerm("Components.Surface")!;
    assert.equal(term.concept!.name, "Component");
    assert.equal(term.taxonomy!.name, "Layers");
    assert.equal(term.broader, undefined);
    assert.deepEqual(term.narrower(), []);
    const tier = m.getType("Component")!.getField("tier")!;
    assert.equal(term.fixes(tier), true);
    assert.equal(term.getFixedValue(tier), "ui");
    const name = m.getType("Component")!.getField("name")!;
    assert.equal(term.fixes(name), false);
  });

  test("taxonomy represents/roots/getTerms", () => {
    const tax = loadShop().getTaxonomy("Layers")!;
    assert.deepEqual(tax.represents().map((t) => t.name), ["Component"]);
    assert.deepEqual(tax.roots().map((t) => t.id), ["Components.Surface"]);
    assert.deepEqual(tax.getTerms().map((t) => t.id), ["Components.Surface"]);
  });
});

describe("SPEC-05 t10: annotations (empty in v1)", () => {
  test("getAnnotations returns [] on type and member", () => {
    const co = loadShop().getType("Component")!;
    assert.deepEqual(co.getAnnotations(), []);
    assert.deepEqual(co.getField("tier")!.getAnnotations(), []);
    assert.deepEqual(co.getInvariants(), []);
  });
});

describe("SPEC-05 t11: InstanceMirror + FieldView (the §5 payoff)", () => {
  test("reflect resolves both axes verbatim", () => {
    const mirror = loadShop().reflect(checkout);
    assert.equal(mirror.type.fullName, "Component");
    assert.equal(mirror.class?.id, "Components.Surface");

    const name = mirror.field("name")!;
    assert.equal(name.value, "Checkout");
    assert.equal(name.definitionOrigin.fullName, "Element"); // Axis 1
    assert.equal(name.valueOrigin, "self"); // Axis 2: instance set it

    const tier = mirror.field("tier")!;
    assert.equal(tier.value, "ui");
    assert.equal(tier.definitionOrigin.fullName, "Component"); // Axis 1
    assert.ok(tier.valueOrigin instanceof TermInfo); // Axis 2: from the term
    assert.equal((tier.valueOrigin as TermInfo).id, "Components.Surface");

    assert.deepEqual(mirror.fields().map((v) => v.field.name), ["tier", "name"]);
  });

  test("instance override of a fixed value → self", () => {
    const overridden: ReflectedNode = { ...checkout, attrs: { name: "Checkout", tier: "api" } };
    const tier = loadShop().reflect(overridden).field("tier")!;
    assert.equal(tier.value, "api");
    assert.equal(tier.valueOrigin, "self");
  });
});

describe("SPEC-05 t12: resolveToken round-trip", () => {
  test("every handle's token resolves back to itself", () => {
    const m = loadShop();
    const co = m.getType("Component")!;
    const field = co.getDeclaredFields()[0]!;
    const rel = co.getDeclaredRelationships()[0]!;
    const term = m.getTerm("Components.Surface")!;
    const tax = m.getTaxonomy("Layers")!;
    for (const h of [co, field, rel, term, tax]) {
      const resolved = m.resolveToken(h.token) as { token: number };
      assert.equal(resolved.token, h.token);
    }
    assert.equal(m.resolveToken(0), undefined);
  });
});

describe("SPEC-05 t13: binary-load parity", () => {
  test("Manifest.load(bytes) yields identical reflection results", () => {
    const json = loadShop(false);
    const bin = loadShop(true);
    assert.deepEqual(
      bin.getType("Component")!.getFields().map((f) => `${f.name}:${f.declaringType.name}`),
      json.getType("Component")!.getFields().map((f) => `${f.name}:${f.declaringType.name}`),
    );
    const jv = json.reflect(checkout).field("tier")!;
    const bv = bin.reflect(checkout).field("tier")!;
    assert.equal(bv.value, jv.value);
    assert.equal((bv.valueOrigin as TermInfo).id, (jv.valueOrigin as TermInfo).id);
  });
});
