import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../../compiler-services/api.js";
import { ManifestEmitter } from "../../../compiler-services/emit/manifest.js";
import { ManifestWriter } from "../../manifest-writer.js";
import { Manifest } from "../reflection.js";

const SRC = `namespace acme {
  concept Technology { name : string; }
  concept Component {
    name : string;
    annotate icon { path = "resources/component.svg"; }
    relationship implementedBy -> Technology { annotate iconSource { order = 1; } }
  }
}`;

function manifest(binary: boolean): Manifest
{
    const model = check([{ uri: "m.todl", text: SRC }]).model;
    const logical = new ManifestEmitter(model, "acme", "1.0.0").emitManifest();
    const writer = ManifestWriter.fromLogical(logical);
    return Manifest.load(binary ? writer.toBinary() : writer.toJSON());
}

for (const binary of [false, true])
{
    const label = binary ? "binary" : "json";

    test(`TypeInfo.getAnnotations reflects a concept annotation (${label})`, () =>
    {
        const component = manifest(binary).getType("Component")!;
        const anns = component.getAnnotations();
        assert.equal(anns.length, 1);
        assert.equal(anns[0]!.type.name, "icon");
        assert.equal(anns[0]!.args.get("path"), "resources/component.svg");
    });

    test(`RelationshipInfo.getAnnotations reflects a member annotation (${label})`, () =>
    {
        const rel = manifest(binary).getType("Component")!.getRelationships().find((r) => r.name === "implementedBy")!;
        const anns = rel.getAnnotations();
        assert.equal(anns.length, 1);
        assert.equal(anns[0]!.type.name, "iconSource");
        assert.equal(anns[0]!.args.get("order"), "1"); // numeric args store as strings
    });
}

test("a concept with no annotations returns []", () =>
{
    assert.deepEqual(manifest(false).getType("Technology")!.getAnnotations(), []);
});

test("FieldInfo.getAnnotations returns [] (fields have no node)", () =>
{
    const nameField = manifest(false).getType("Component")!.getField("name")!;
    assert.deepEqual(nameField.getAnnotations(), []);
});
