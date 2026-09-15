import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Domain, type PackageSource, type PackageRef, type ResolvedPackage } from "../domain.js";
import { ManifestWriter } from "../../manifest/manifest-writer.js";
import { MetaKind } from "../../manifest/enums.js";
import { TypeDefOrRef } from "../../manifest/token.js";
import type { ManifestJson } from "../../manifest/records.js";
import type { LogicalManifest } from "../../manifest/logical.js";
import type { ReflectedNode } from "../../manifest/reflection/reflection.js";

// ── manifest builders ───────────────────────────────────────────────────

// A trivial single-concept manifest via the SPEC-03→04 bridge.
function soloManifest(model: string, concept: string): ManifestJson {
  const logical: LogicalManifest = {
    format: "todl-manifest/1", model, version: "1.0.0", root: "Element",
    concepts: {
      Element: { extends: null, fields: {}, relationships: {}, invariants: [] },
      [concept]: {
        extends: "Element",
        fields: { label: { type: "string", card: "?" } },
        relationships: {}, invariants: [],
      },
    },
    classes: {}, taxonomies: {},
  };
  return ManifestWriter.fromLogical(logical).toJSON();
}

// Manifest "b" defines Base; manifest "a" has Sub extends b:Base via Imports+TypeRef.
function manifestB(): ManifestJson {
  const w = new ManifestWriter("b", "1.0.0");
  const base = w.addTypeInfo({
    name: w.internString("Base"), ns: 0, kind: MetaKind.Concept,
    extends: 0, fieldStart: 0, fieldCount: 0, relStart: 0, relCount: 0,
  });
  w.setRoot(base);
  return w.toJSON();
}
function manifestA(): ManifestJson {
  const w = new ManifestWriter("a", "1.0.0");
  const imp = w.addImport({ model: w.internString("b"), version: w.internString("1.0.0") });
  const ref = w.addTypeRef({ import: imp, name: w.internString("Base") });
  const sub = w.addTypeInfo({
    name: w.internString("Sub"), ns: 0, kind: MetaKind.Concept,
    extends: new TypeDefOrRef(true, ref).encode(),
    fieldStart: 0, fieldCount: 0, relStart: 0, relCount: 0,
  });
  w.setRoot(sub);
  return w.toJSON();
}

// ── a fake package source (no network) ──────────────────────────────────

class FakeSource implements PackageSource {
  private readonly pkgs = new Map<string, ResolvedPackage>();

  register(model: string, version: string, manifest: ManifestJson, deps: PackageRef[] = [], seed?: ResolvedPackage["seed"]): void {
    const pkg: ResolvedPackage = { ref: { model, version }, manifest, dependencies: deps };
    if (seed !== undefined) pkg.seed = seed;
    this.pkgs.set(`${model}@${version}`, pkg);
  }

  async resolve(ref: PackageRef): Promise<ResolvedPackage> {
    const found = this.pkgs.get(`${ref.model}@${ref.version}`);
    if (found === undefined) throw new Error(`unknown package ${ref.model}@${ref.version}`);
    return found;
  }

  async versions(model: string): Promise<readonly string[]> {
    return [...this.pkgs.keys()].filter((k) => k.startsWith(`${model}@`)).map((k) => k.split("@")[1]!);
  }
}

describe("SPEC-06 t1-4: load + register + dedup + deps-first", () => {
  test("load returns a matching Manifest and registers it", async () => {
    const src = new FakeSource();
    src.register("shop", "1.0.0", soloManifest("shop", "Widget"));
    const domain = new Domain(src);
    const loaded: string[] = [];
    domain.onManifestLoaded.subscribe((m) => loaded.push(m.model));

    const m = await domain.load({ model: "shop", version: "1.0.0" });
    assert.equal(m.model, "shop");
    assert.equal(m.version, "1.0.0");
    assert.equal(domain.getManifest("shop")?.model, "shop");
    assert.deepEqual(domain.manifests.map((x) => x.model), ["shop"]);
    assert.deepEqual(loaded, ["shop"]);
  });

  test("omitted version pins the latest via versions()", async () => {
    const src = new FakeSource();
    src.register("shop", "1.0.0", soloManifest("shop", "Widget"));
    const domain = new Domain(src);
    const m = await domain.load({ model: "shop" });
    assert.equal(m.version, "1.0.0");
  });

  test("dedup: loading the same identity twice → same instance, one event", async () => {
    const src = new FakeSource();
    src.register("shop", "1.0.0", soloManifest("shop", "Widget"));
    const domain = new Domain(src);
    let events = 0;
    domain.onManifestLoaded.subscribe(() => events++);
    const a = await domain.load({ model: "shop", version: "1.0.0" });
    const b = await domain.load({ model: "shop", version: "1.0.0" });
    assert.equal(a, b);
    assert.equal(events, 1);
  });

  test("deps-first: a→b emits b before a; diamond loads b once", async () => {
    const src = new FakeSource();
    src.register("b", "1.0.0", manifestB());
    src.register("a", "1.0.0", manifestA(), [{ model: "b", version: "1.0.0" }]);
    src.register("c", "1.0.0", soloManifest("c", "C"), [{ model: "b", version: "1.0.0" }]);
    const domain = new Domain(src);
    const loaded: string[] = [];
    domain.onManifestLoaded.subscribe((m) => loaded.push(m.model));
    await domain.load({ model: "a", version: "1.0.0" });
    await domain.load({ model: "c", version: "1.0.0" });
    assert.deepEqual(loaded, ["b", "a", "c"]); // b before a; not re-loaded for c
  });
});

describe("SPEC-06 t8: cross-manifest resolution", () => {
  test("baseType hops a TypeRef into the dependency manifest", async () => {
    const src = new FakeSource();
    src.register("b", "1.0.0", manifestB());
    src.register("a", "1.0.0", manifestA(), [{ model: "b", version: "1.0.0" }]);
    const domain = new Domain(src);
    await domain.load({ model: "a", version: "1.0.0" });

    const sub = domain.getType("a:Sub")!;
    assert.equal(sub.fullName, "Sub");
    assert.equal(sub.baseType!.name, "Base"); // hopped into b
    assert.equal(sub.isSubtypeOf(domain.getType("b:Base")!), true);
  });

  test("resolveToken lands in the named manifest", async () => {
    const src = new FakeSource();
    src.register("b", "1.0.0", manifestB());
    src.register("a", "1.0.0", manifestA(), [{ model: "b", version: "1.0.0" }]);
    const domain = new Domain(src);
    await domain.load({ model: "a", version: "1.0.0" });
    const base = domain.resolveToken({ manifestId: "b@1.0.0", table: 0, row: 1 });
    assert.equal((base as { name: string }).name, "Base");
    assert.equal(domain.resolveToken({ manifestId: "nope@1", table: 0, row: 1 }), undefined);
  });
});

describe("SPEC-06 t5: onResolveManifest fallback", () => {
  test("a rejected ref is satisfied by a handler; unhandled rejects", async () => {
    const src = new FakeSource();
    const domain = new Domain(src);
    // no handler → reject
    await assert.rejects(domain.load({ model: "ghost", version: "1.0.0" }));
    // handler supplies the package
    domain.onResolveManifest.subscribe((req) => {
      if (req.ref.model === "ghost")
        req.resolved = { ref: { model: "ghost", version: "1.0.0" }, manifest: soloManifest("ghost", "G"), dependencies: [] };
    });
    const m = await domain.load({ model: "ghost", version: "1.0.0" });
    assert.equal(m.model, "ghost");
  });
});

describe("SPEC-06 t6/t10: bindGraph + seed + reflect", () => {
  const widget: ReflectedNode = { id: "w1", type: "Widget", namespace: "shop", attrs: { label: "Hi" } };

  test("seed nodes merge into the heap and reflect via their manifest", async () => {
    const src = new FakeSource();
    src.register("shop", "1.0.0", soloManifest("shop", "Widget"), [], { nodes: [widget] });
    const domain = new Domain(src);
    await domain.load({ model: "shop", version: "1.0.0" });
    assert.equal(domain.graph.size, 1);
    const mirror = domain.reflect(domain.graph.getNode("w1")!);
    assert.equal(mirror.type.name, "Widget");
    assert.equal(mirror.field("label")!.value, "Hi");
  });

  test("bindGraph throws when a node's type is not defined by any manifest", async () => {
    const src = new FakeSource();
    src.register("shop", "1.0.0", soloManifest("shop", "Widget"));
    const domain = new Domain(src);
    await domain.load({ model: "shop", version: "1.0.0" });
    assert.throws(() => domain.bindGraph({ nodes: [{ id: "x", type: "Nope", attrs: {} }] }, { model: "shop", version: "1.0.0" }));
  });
});

describe("SPEC-06 t7-8: tryUnload guards + cascade", () => {
  test("Guard B: refuse unloading a manifest another imports", async () => {
    const src = new FakeSource();
    src.register("b", "1.0.0", manifestB());
    src.register("a", "1.0.0", manifestA(), [{ model: "b", version: "1.0.0" }]);
    const domain = new Domain(src);
    await domain.load({ model: "a", version: "1.0.0" });
    assert.equal(domain.tryUnload({ model: "b", version: "1.0.0" }), false);
    assert.equal(domain.manifests.length, 2); // unchanged
  });

  test("Guard A: refuse when a foreign node binds to the manifest", async () => {
    const src = new FakeSource();
    src.register("types", "1.0.0", soloManifest("types", "Widget"));
    const domain = new Domain(src);
    await domain.load({ model: "types", version: "1.0.0" });
    domain.bindGraph({ nodes: [{ id: "n1", type: "Widget", attrs: {} }] }, { model: "app", version: "9.9.9" });
    assert.equal(domain.tryUnload({ model: "types", version: "1.0.0" }), false);
  });

  test("no refs: unload succeeds, event fires, cascade frees the dependency", async () => {
    const src = new FakeSource();
    src.register("b", "1.0.0", manifestB());
    src.register("a", "1.0.0", manifestA(), [{ model: "b", version: "1.0.0" }]);
    const domain = new Domain(src);
    await domain.load({ model: "a", version: "1.0.0" });
    const unloaded: string[] = [];
    domain.onManifestUnloaded.subscribe((m) => unloaded.push(m.model));

    assert.equal(domain.tryUnload({ model: "b", version: "1.0.0" }), false); // still imported by a
    assert.equal(domain.tryUnload({ model: "a", version: "1.0.0" }), true); // a has no importers
    assert.equal(domain.tryUnload({ model: "b", version: "1.0.0" }), true); // now free (cascade)
    assert.deepEqual(unloaded, ["a", "b"]);
    assert.equal(domain.manifests.length, 0);
  });

  test("evict-own: a manifest whose only binder is its own seed unloads", async () => {
    const src = new FakeSource();
    const seed = { nodes: [{ id: "w1", type: "Widget", attrs: {} }] };
    src.register("shop", "1.0.0", soloManifest("shop", "Widget"), [], seed);
    const domain = new Domain(src);
    await domain.load({ model: "shop", version: "1.0.0" });
    assert.equal(domain.graph.size, 1);
    assert.equal(domain.tryUnload({ model: "shop", version: "1.0.0" }), true);
    assert.equal(domain.graph.size, 0); // own seed evicted
  });
});

describe("SPEC-06 t13: isolation + ambient", () => {
  test("two Domains over one source share nothing", async () => {
    const src = new FakeSource();
    src.register("shop", "1.0.0", soloManifest("shop", "Widget"), [], { nodes: [{ id: "w1", type: "Widget", attrs: {} }] });
    const d1 = new Domain(src);
    const d2 = new Domain(src);
    await d1.load({ model: "shop", version: "1.0.0" });
    assert.equal(d1.manifests.length, 1);
    assert.equal(d2.manifests.length, 0); // invisible to d2
    assert.equal(d1.graph.size, 1);
    assert.equal(d2.graph.size, 0);
  });

  test("Domain.current is not auto-set; it is assignable by the host", async () => {
    const src = new FakeSource();
    const d = new Domain(src);
    assert.equal(Domain.current, undefined);
    Domain.current = d;
    assert.equal(Domain.current, d);
    Domain.current = undefined;
  });
});
