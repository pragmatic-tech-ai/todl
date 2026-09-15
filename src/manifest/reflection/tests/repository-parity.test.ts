import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Repository } from "../../../model/model.js";
import { Cardinality } from "../../../model/graph.js";
import { ManifestEmitter } from "../../../emit/manifest.js";
import { ManifestWriter } from "../../manifest-writer.js";
import { Manifest } from "../reflection.js";
import type { ReflectedNode } from "../reflection.js";

// A Repository fixture whose emitted manifest we reflect over, then cross-check
// reflection results against the live Repository (SPEC-05 §7.10). Parity holds
// where instance-wins and class-wins agree: the instance does NOT override the
// class-fixed field, so both resolutions yield the same effective value.
function buildRepo(): Repository {
  const repo = new Repository();
  repo
    .builder()
    .defineConcept("Element")
    .addField("Element", "label", "string", Cardinality.Optional)
    .defineConcept("Component", "Element")
    .addField("Component", "tier", "string", Cardinality.One)
    .defineTaxonomy("Kinds", ["Component"], [
      { id: "ui", concept: "Component", attrs: new Map([["tier", "ui"]]) },
    ])
    .setNamespace("app")
    .assertInstance("Component", "app.home")
    .setField("app.home", "label", "Home")
    .addInstanceOf("app.home", "Kinds.ui") // inherits tier="ui"; does NOT override it
    .commit();
  return repo;
}

describe("SPEC-05 t14: reflection ↔ Repository parity", () => {
  test("TypeInfo.getFields names == Repository.effectiveSchema fields", () => {
    const repo = buildRepo();
    const manifest = Manifest.load(ManifestWriter.fromLogical(
      new ManifestEmitter(repo, "app", "1.0.0").emitManifest(),
    ).toJSON());

    const reflected = new Set(manifest.getType("Component")!.getFields().map((f) => f.name));
    const fromRepo = new Set(repo.effectiveSchema("Component").fields.map((f) => f.name));
    assert.deepEqual(reflected, fromRepo);
    assert.deepEqual(reflected, new Set(["tier", "label"]));
  });

  test("InstanceMirror field values == Repository.attr for non-overridden fields", () => {
    const repo = buildRepo();
    const { manifest: logical, graph } = new ManifestEmitter(repo, "app", "1.0.0").emit();
    const manifest = Manifest.load(ManifestWriter.fromLogical(logical).toJSON());
    const node = graph.nodes.find((n) => n.id === "app.home")! as ReflectedNode;
    const mirror = manifest.reflect(node);

    for (const name of ["label", "tier"]) {
      assert.equal(mirror.field(name)!.value, repo.attr("app.home", name));
    }
    assert.equal(mirror.field("tier")!.value, "ui"); // from the class
    assert.equal(mirror.field("label")!.value, "Home"); // instance's own
  });
});
