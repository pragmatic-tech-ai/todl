import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../api.js";
import { ManifestEmitter } from "../manifest.js";
import type { LogicalManifest } from "../../../manifest/logical.js";

// A meta-model that annotates a concept, a relationship member, and a taxonomy
// term with the prelude `icon` / `iconSource` annotations. (Numeric annotation
// args store as strings — TODL has no Number value kind.)
const SRC = `namespace acme {
  concept Technology { name : string; }
  concept Component {
    name : string;
    annotate icon { path = "resources/component.svg"; }
    relationship implementedBy -> Technology { annotate iconSource { order = 1; } }
  }
  taxonomy Categories : represents Component {
    term api { annotate icon { path = "resources/api.svg"; } }
  }
}`;

function emit(): LogicalManifest
{
    const model = check([{ uri: "m.todl", text: SRC }]).model;
    return new ManifestEmitter(model, "acme", "1.0.0").emitManifest();
}

test("emitManifest carries a concept annotation", () =>
{
    const anns = emit().concepts["Component"]!.annotations;
    assert.equal(anns.length, 1);
    assert.equal(anns[0]!.annotation, "icon");
    assert.equal(anns[0]!.args["path"], "resources/component.svg");
});

test("emitManifest carries a relationship-member annotation", () =>
{
    const rel = emit().concepts["Component"]!.relationships["implementedBy"]!;
    assert.equal(rel.annotations.length, 1);
    assert.equal(rel.annotations[0]!.annotation, "iconSource");
    assert.equal(rel.annotations[0]!.args["order"], "1"); // numeric args store as strings
});

test("emitManifest carries a term annotation", () =>
{
    const classes = emit().classes;
    const term = Object.values(classes).find((c) => c.annotations.length > 0);
    assert.ok(term, "expected a term carrying an annotation");
    assert.ok(term!.annotations.some((a) => a.annotation === "icon" && a.args["path"] === "resources/api.svg"));
});

test("a concept with no annotations has an empty annotations array", () =>
{
    assert.deepEqual(emit().concepts["Technology"]!.annotations, []);
});
