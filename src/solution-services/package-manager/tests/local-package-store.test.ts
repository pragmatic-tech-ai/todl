import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalPackageStore } from "../local-package-store.js";
import { compilePackage } from "../../../publish/publish.js";

function pkg(id: string, version: string)
{
  const out = compilePackage(
    [],
    [{ uri: `${id}.todl`, text: `namespace acme { concept Widget { name : string; } }` }],
    { id, version },
  );
  assert.ok(out.ok && out.package, "fixture must compile");
  return out.package!;
}

test("register then get/has/versions round-trips by id@version", () => {
  const store = new LocalPackageStore();
  store.register(pkg("acme.widgets", "1.0.0"));
  store.register(pkg("acme.widgets", "1.1.0"));
  assert.equal(store.has("acme.widgets", "1.0.0"), true);
  assert.equal(store.get("acme.widgets", "1.1.0")?.version, "1.1.0");
  assert.deepEqual(store.versions("acme.widgets").sort(), ["1.0.0", "1.1.0"]);
  assert.equal(store.get("acme.widgets", "9.9.9"), undefined);
  assert.deepEqual(store.versions("nope"), []);
});
