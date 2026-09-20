import { test } from "node:test";
import assert from "node:assert/strict";
import { PackageManifestBridge } from "../package-manifest-bridge.js";
import { check } from "../../api.js";
import { compilePackage } from "../../publish/publish.js";
import { ManifestWriter } from "../../manifest/manifest-writer.js";
import { Manifest } from "../../manifest/reflection/reflection.js";

// Compile a tiny self-contained model the real way; emit its logical manifest.
function logical()
{
  const { model, diagnostics } = check([{
    uri: "widgets.todl",
    text: `namespace acme {
      concept Widget { name : string; color : string?; parts : Widget[]; }
    }`,
  }]);
  assert.deepEqual(diagnostics, [], "fixture compiles clean");
  return PackageManifestBridge.toLogical(model, "acme.widgets", "1.0.0");
}

test("toLogical carries model/version/root and the own concept's fields", () => {
  const m = logical();
  assert.equal(m.format, "todl-manifest/1");
  assert.equal(m.model, "acme.widgets");
  assert.equal(m.version, "1.0.0");
  assert.equal(m.root, "Element");
  const widget = m.concepts["Widget"];
  assert.ok(widget, "Widget concept emitted");
  // Reference members are type-directed: `parts : Widget[]` is a concept-typed
  // FIELD (its value materializes as an edge at instance time), not a rel.
  assert.equal(widget.fields["name"]?.card, "1");
  assert.equal(widget.fields["name"]?.type, "string");
  assert.equal(widget.fields["color"]?.card, "?");
  assert.equal(widget.fields["parts"]?.card, "*");
  assert.equal(widget.fields["parts"]?.type, "Widget");
});

// Taxonomy/class lowering is ManifestEmitter's job (covered in
// src/emit/tests/manifest.test.ts); the bridge only delegates, so it is not
// re-proved here.

test("toResolved yields loadable manifest bytes + mapped deps, no seed", () => {
  const out = compilePackage(
    [],
    [{ uri: "w.todl", text: `namespace acme { concept Widget { name : string; } }` }],
    { id: "acme.widgets", version: "2.0.0" },
  );
  assert.ok(out.ok && out.package);
  const resolved = PackageManifestBridge.toResolved(out.package!);
  assert.deepEqual(resolved.ref, { model: "acme.widgets", version: "2.0.0" });
  assert.deepEqual([...resolved.dependencies], []);
  assert.equal(resolved.seed, undefined);
  const manifest = Manifest.load(resolved.manifest as Uint8Array);
  assert.equal(manifest.model, "acme.widgets");
  assert.notEqual(manifest.getType("Widget"), undefined);
});

test("toResolved carries instance nodes + relationship edges as a seed graph", () => {
  const out = compilePackage([], [{
    uri: "m.todl",
    text: `namespace acme {
      concept Widget { name : string; parts : Widget[]; }
      model M : acme { Widget a { name = "A"; parts = b; } Widget b { name = "B"; } }
    }`,
  }], { id: "acme.m", version: "1.0.0" });
  assert.ok(out.ok && out.package);
  const resolved = PackageManifestBridge.toResolved(out.package!);
  assert.ok(resolved.seed, "seed present");
  const ids = resolved.seed!.nodes.map((n) => n.id).sort();
  assert.ok(ids.includes("a") && ids.includes("b"), "instances seeded");
  const a = resolved.seed!.nodes.find((n) => n.id === "a")!;
  assert.equal(a.type, "Widget");
  assert.deepEqual(resolved.seed!.edges, [{ from: "a", rel: "parts", to: "b" }]);
});
