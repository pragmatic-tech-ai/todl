import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../compiler-services/api.js";
import { toJSON } from "../../compiler-services/emit/json.js";
import type { SourceFile } from "../../compiler-services/diagnostics/span.js";
import { compilePackage, PackageKind } from "../publish.js";

const META_SRC = `namespace ea {
  concept Technology { }
}`;
const META: SourceFile = { uri: "ea.todl", text: META_SRC };

// A base meta-model + a library taxonomy over its concepts (proven-clean shape).
const BASE: SourceFile = {
  uri: "meta.todl",
  text: `namespace ea {
    concept Location   { }
    concept Technology { }
  }`,
};
const LIB: SourceFile = {
  uri: "lib.todl",
  text: `namespace lib {
    import ea;
    taxonomy Microsoft : represents Location, Technology {
      Location azure { label = "Azure"; }
      Technology azureOpenai { label = "Azure OpenAI"; }
    }
  }`,
};

describe("compilePackage", () => {
  test("clean sources → ok; document is own-only, fullDocument is the closure", () => {
    const out = compilePackage([], [META], { id: "ea", version: "0.1.0" });
    assert.equal(out.ok, true);
    assert.equal(out.errors.length, 0);
    assert.ok(out.package);
    const pkg = out.package!;

    const ownIds = new Set(pkg.document.nodes.map((n) => n.id));
    assert.ok(ownIds.has("ea.Technology"), "own concept present");
    assert.ok(!ownIds.has("todl.identifier"), "prelude node excluded from own document");
    assert.equal(pkg.document.dependencies, undefined, "no deps → field omitted");

    // fullDocument is the whole compiled closure (prelude included).
    assert.ok(pkg.fullDocument.nodes.some((n) => n.id === "todl.identifier"), "fullDocument has prelude");
    assert.equal(pkg.id, "ea");
    assert.equal(pkg.version, "0.1.0");
  });

  test("debug off (default): package documents carry no debug metadata", () => {
    const pkg = compilePackage([], [META], { id: "ea", version: "0.1.0" }).package!;
    assert.ok(pkg.document.nodes.every((n) => n.debug === undefined), "own doc plain");
    assert.ok(pkg.fullDocument.nodes.every((n) => n.debug === undefined), "full doc plain");
  });

  test("debug on: own + full documents carry readable metadata (with provenance)", () => {
    const pkg = compilePackage([], [META], { id: "ea", version: "0.1.0" }, undefined, {
      debug: true,
    }).package!;
    const tech = pkg.document.nodes.find((n) => n.id === "ea.Technology");
    assert.deepEqual(tech?.debug, {
      kind: "concept", name: "ea.Technology", type: "concept", namespace: "ea", source: "ea.todl",
    });
    assert.ok(pkg.fullDocument.nodes.some((n) => n.debug !== undefined), "full doc annotated too");
  });

  test("erroring sources → not ok, errors populated, no package", () => {
    const bad: SourceFile = { uri: "x.todl", text: `namespace x { concept C { f : NonexistentType; } }` };
    const out = compilePackage([], [bad], { id: "x", version: "0.1.0" });
    assert.equal(out.ok, false);
    assert.ok(out.errors.length > 0);
    assert.equal(out.package, undefined);
  });

  test("against a base: document excludes base nodes and records dependencies", () => {
    const base = toJSON(check([BASE]).model);
    const deps = [{ kind: PackageKind.MetaModel, id: "ea", version: "1.0.0" }];
    const out = compilePackage([base], [LIB], { id: "lib", version: "0.1.0" }, deps);
    assert.ok(out.ok && out.package);
    const pkg = out.package!;

    const ownIds = new Set(pkg.document.nodes.map((n) => n.id));
    assert.ok(ownIds.has("lib.Microsoft.azure"), "own class term present");
    assert.ok(!ownIds.has("ea.Location"), "base concept excluded from own document");
    assert.ok(!ownIds.has("todl.identifier"), "prelude excluded from own document");
    assert.deepEqual(pkg.document.dependencies, deps, "dependencies recorded");

    // fullDocument still carries the base concept.
    assert.ok(pkg.fullDocument.nodes.some((n) => n.id === "ea.Location"), "fullDocument has base");
    // Derived classes are own-only.
    assert.ok(pkg.classes.some((c) => c.id === "lib.Microsoft.azure"));
    assert.ok(!pkg.classes.some((c) => c.id === "ea.Location"));
  });

  test("attaches non-empty resources to the package", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const out = compilePackage(
      [], [META], { id: "ea", version: "0.1.0" }, undefined, undefined,
      [{ path: "resources/az.svg", bytes }],
    );
    assert.ok(out.ok && out.package);
    assert.deepEqual(out.package!.resources, [{ path: "resources/az.svg", bytes }]);
  });

  test("omits resources when none are passed", () => {
    const out = compilePackage([], [META], { id: "ea", version: "0.1.0" });
    assert.ok(out.ok && out.package);
    assert.equal(out.package!.resources, undefined);
  });

  test("omits resources when an empty array is passed", () => {
    const out = compilePackage(
      [], [META], { id: "ea", version: "0.1.0" }, undefined, undefined, [],
    );
    assert.ok(out.ok && out.package);
    assert.equal(out.package!.resources, undefined);
  });
});

/** A library's datasource and an app over it that redeclares the datasource identically (ruling P16). */
class RedeclaredDatasourceFx
{
    public static readonly Library: SourceFile = { uri: "lib.todl", text: 'namespace crm { concept Customer { } datasource crm { kind = sql; connection = "crm-db"; } }' };
    public static readonly App: SourceFile = { uri: "app.todl", text: 'namespace crm { datasource crm { connection = "crm-db"; kind = sql; } model App : crm { } }' };
    public static readonly AppWithout: SourceFile = { uri: "app.todl", text: "namespace crm { model App : crm { } }" };
    public static readonly ConnectorId = "crm@connector:crm";
    public static readonly LibraryId = { id: "crm.lib", version: "1.0.0" };
    public static readonly AppId = { id: "crm.app", version: "1.0.0" };

    public static OwnConnectors(app: SourceFile): string[]
    {
        const library = compilePackage([], [RedeclaredDatasourceFx.Library], RedeclaredDatasourceFx.LibraryId);
        assert.ok(library.ok && library.package);
        const out = compilePackage([library.package!.document], [app], RedeclaredDatasourceFx.AppId);
        assert.ok(out.ok && out.package, JSON.stringify(out.errors));
        assert.equal(out.package!.fullDocument.nodes.filter((n) => n.id === RedeclaredDatasourceFx.ConnectorId).length, 1);
        return out.package!.document.nodes.filter((n) => n.id === RedeclaredDatasourceFx.ConnectorId).map((n) => n.id);
    }
}

test("a package redeclaring a base datasource identically keeps it in its own-only document (P16)", () =>
{
    assert.deepEqual(RedeclaredDatasourceFx.OwnConnectors(RedeclaredDatasourceFx.App), [RedeclaredDatasourceFx.ConnectorId]);
    assert.deepEqual(RedeclaredDatasourceFx.OwnConnectors(RedeclaredDatasourceFx.AppWithout), []);
});
