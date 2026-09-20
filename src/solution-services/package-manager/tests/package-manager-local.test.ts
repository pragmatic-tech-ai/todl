import { test } from "node:test";
import assert from "node:assert/strict";
import { PackageManager } from "../package-manager.js";
import { LocalPackageStore } from "../local-package-store.js";
import { compilePackage } from "../../../publish/publish.js";
import { Manifest } from "../../../manifest/reflection/reflection.js";

function widget(id: string, version: string)
{
  const out = compilePackage(
    [],
    [{ uri: "w.todl", text: `namespace acme { concept Widget { name : string; } }` }],
    { id, version },
  );
  return out.package!;
}

// A config whose registry is unreachable — proves the local path makes no network call.
const offline = { registry: "http://127.0.0.1:0", scope: "@acme", org: "acme", githubApi: "http://127.0.0.1:0", token: "" };

test("resolveResolved returns the local package without touching the network", async () => {
  const store = new LocalPackageStore();
  store.register(widget("acme.widgets", "1.0.0"));
  const pm = new PackageManager(offline, store);
  const resolved = await pm.resolveResolved({ model: "acme.widgets", version: "1.0.0" });
  assert.deepEqual(resolved.ref, { model: "acme.widgets", version: "1.0.0" });
  assert.equal(Manifest.load(resolved.manifest as Uint8Array).model, "acme.widgets");
});

test("resolvedVersions includes locally-registered versions", async () => {
  const store = new LocalPackageStore();
  store.register(widget("acme.widgets", "1.0.0"));
  store.register(widget("acme.widgets", "1.2.0"));
  const pm = new PackageManager(offline, store);
  assert.deepEqual(await pm.resolvedVersions("acme.widgets"), ["1.0.0", "1.2.0"]);
});

test("resolveResolved with no version pins the latest local version", async () => {
  const store = new LocalPackageStore();
  store.register(widget("acme.widgets", "1.0.0"));
  store.register(widget("acme.widgets", "1.2.0"));
  const pm = new PackageManager(offline, store);
  const resolved = await pm.resolveResolved({ model: "acme.widgets" });
  assert.equal(resolved.ref.version, "1.2.0");
});
