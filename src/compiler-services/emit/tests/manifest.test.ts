import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Repository } from "../../model/model.js";
import { Cardinality } from "../../model/graph.js";
import { ManifestEmitter } from "../manifest.js";
import { ManifestModel, SELF_ORIGIN } from "../../../manifest/logical.js";
import { ManifestWriter } from "../../../manifest/manifest-writer.js";
import { ManifestReader } from "../../../manifest/manifest-reader.js";
import { ManifestValidator } from "../../../manifest/manifest-validator.js";
import { TableId } from "../../../manifest/enums.js";

// Fixture: Element <- Component <- Surface; Component declares name + color and
// a dependsOn relationship; Surface overrides color (subtype wins). A taxonomy
// ComponentKinds has a term Surface (concept Surface) fixing color="red". Two
// instances instantiate that term: header takes the class colour, footer
// overrides it to "blue".
function buildRepo(): Repository
{
  const repo = new Repository();
  repo
    .builder()
    .defineConcept("Element")
    .defineConcept("Component", "Element")
    .addField("Component", "name", "string", Cardinality.One)
    .addField("Component", "color", "string", Cardinality.Optional)
    .addConceptRelationship("Component", "dependsOn", ["Component"], Cardinality.Many, "usedBy")
    .defineConcept("Surface", "Component")
    .addField("Surface", "color", "string", Cardinality.One)
    .defineTaxonomy("ComponentKinds", ["Component"], [
      { id: "Surface", concept: "Surface", attrs: new Map([["color", "red"]]) },
    ])
    .setNamespace("shop")
    .assertInstance("Component", "shop.header")
    .setField("shop.header", "name", "Header")
    .addInstanceOf("shop.header", "ComponentKinds.Surface")
    .assertInstance("Component", "shop.footer")
    .setField("shop.footer", "name", "Footer")
    .setField("shop.footer", "color", "blue")
    .addInstanceOf("shop.footer", "ComponentKinds.Surface")
    .addRelationship("shop.header", "dependsOn", "shop.footer")
    .commit();
  return repo;
}

function emit()
{
  return new ManifestEmitter(buildRepo(), "shop", "1.0.0").emit();
}

describe("ManifestEmitter — concepts (SPEC-03 task 4)", () => {
  test("concepts are declared-only with single extends + glyph cardinalities", () => {
    const { manifest } = emit();
    // Surface declares ONLY color (name is inherited, not stored)
    assert.deepEqual(Object.keys(manifest.concepts.Surface!.fields), ["color"]);
    assert.equal(manifest.concepts.Surface!.extends, "Component");
    assert.equal(manifest.concepts.Surface!.fields.color!.card, "1"); // override tightened ?->1
    assert.equal(manifest.concepts.Component!.fields.name!.card, "1");
    assert.equal(manifest.concepts.Component!.fields.color!.card, "?");
  });

  test("relationships carry targets, glyph, and inverse", () => {
    const dep = emit().manifest.concepts.Component!.relationships.dependsOn!;
    assert.deepEqual(dep.targets, ["Component"]);
    assert.equal(dep.card, "*");
    assert.equal(dep.inverse, "usedBy");
  });

  test("Element is a rule, not an edge: extends null, empty schema", () => {
    const el = emit().manifest.concepts.Element!;
    assert.equal(el.extends, null);
    assert.deepEqual(el.fields, {});
    assert.equal(emit().manifest.root, "Element");
  });
});

describe("ManifestEmitter — classes + taxonomies (SPEC-03 task 5)", () => {
  test("class fixed values exclude structural markers", () => {
    const cls = emit().manifest.classes["ComponentKinds.Surface"]!;
    assert.equal(cls.concept, "Surface");
    assert.deepEqual(cls.fixed, { color: "red" }); // no class/id/namespace
    assert.equal(cls.taxonomy, "ComponentKinds");
  });

  test("taxonomy represents its concept and lists broader-less roots", () => {
    const tax = emit().manifest.taxonomies.ComponentKinds!;
    assert.deepEqual(tax.represents, ["Component"]);
    assert.deepEqual(tax.roots, ["ComponentKinds.Surface"]);
  });
});

describe("ManifestEmitter — flattened data graph (SPEC-03 task 6)", () => {
  test("instance nodes are flattened (instance-wins), user-only attrs", () => {
    const { graph } = emit();
    const header = graph.nodes.find((n) => n.id === "shop.header")!;
    const footer = graph.nodes.find((n) => n.id === "shop.footer")!;
    assert.equal(header.type, "Component");
    assert.equal(header.class, "ComponentKinds.Surface");
    assert.equal(header.namespace, "shop");
    assert.deepEqual(header.attrs, { name: "Header", color: "red" }); // class fills colour
    assert.deepEqual(footer.attrs, { name: "Footer", color: "blue" }); // instance wins
    assert.equal(graph.manifestRef.model, "shop");
  });

  test("class/term definition nodes are NOT emitted as data nodes", () => {
    const ids = emit().graph.nodes.map((n) => n.id);
    assert.equal(ids.includes("ComponentKinds.Surface"), false);
    assert.deepEqual(new Set(ids), new Set(["shop.header", "shop.footer"]));
  });

  test("only relationship edges survive — no inheritance/contains edges", () => {
    const { graph } = emit();
    assert.deepEqual(graph.edges, [
      { from: "shop.header", rel: "dependsOn", to: "shop.footer" },
    ]);
  });
});

describe("ManifestEmitter — end-to-end origin round-trip (SPEC-03 task 7)", () => {
  test("Axis 1 typeOriginOf over the emitted manifest", () => {
    const model = ManifestModel.fromJSON(emit().manifest);
    assert.equal(model.typeOriginOf("Surface", "name"), "Component"); // inherited
    assert.equal(model.typeOriginOf("Surface", "color"), "Surface"); // override wins
    assert.equal(model.typeOriginOf("Surface", "nope"), undefined);
  });

  test("Axis 2 valueOriginOf over emitted manifest + emitted nodes", () => {
    const { manifest, graph } = emit();
    const model = ManifestModel.fromJSON(manifest);
    const header = graph.nodes.find((n) => n.id === "shop.header")!;
    const footer = graph.nodes.find((n) => n.id === "shop.footer")!;
    assert.equal(model.valueOriginOf(header, "color"), "ComponentKinds.Surface"); // from class
    assert.equal(model.valueOriginOf(footer, "color"), SELF_ORIGIN); // overridden
    assert.equal(model.valueOriginOf(header, "name"), SELF_ORIGIN); // class doesn't fix name
  });
});

describe("ManifestEmitter — debug-JSON round-trip (SPEC-03 task 8)", () => {
  test("logical manifest → JSON → logical manifest is identity", () => {
    const manifest = emit().manifest;
    assert.deepEqual(JSON.parse(JSON.stringify(manifest)), manifest);
  });
});

describe("end-to-end: Repository → emitter → fromLogical → binary", () => {
  test("the emitted manifest lowers to a valid binary manifest", () => {
    const manifest = emit().manifest;
    const reader = ManifestReader.fromBinary(ManifestWriter.fromLogical(manifest).toBinary());
    assert.equal(new ManifestValidator(reader).isValid, true);
    assert.equal(reader.model, "shop");
    // Element / Component / Surface concepts survive the round trip
    const names = new Set<string>();
    for (let i = 1; i <= reader.rowCount(TableId.TypeInfo); i++)
      names.add(reader.getString(reader.typeInfo(i).name));
    for (const c of ["Element", "Component", "Surface"]) assert.equal(names.has(c), true);
    // the pinned class value made it into #Const
    assert.equal(reader.getConst(reader.fixed(1).value), "red");
  });
});
