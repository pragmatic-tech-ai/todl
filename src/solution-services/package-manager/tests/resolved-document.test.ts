import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import { compilePackage } from "../../../publish/publish.js";
import { PackageManifestBridge } from "../package-manifest-bridge.js";
import { StoragePackageSource } from "../storage-package-source.js";

const SOURCE = { uri: "acme.todl", text: `namespace acme { concept Widget { name : string; } }` };

test("toResolved surfaces the package's own-only document", () =>
{
    const out = compilePackage([], [SOURCE], { id: "acme.a", version: "1.0.0" });
    assert.ok(out.ok && out.package);
    const resolved = PackageManifestBridge.toResolved(out.package!);
    assert.deepEqual(resolved.document, out.package!.document);
});

test("StoragePackageSource.resolve surfaces the stored model.json document", async () =>
{
    const out = compilePackage([], [SOURCE], { id: "acme.a", version: "1.0.0" });
    assert.ok(out.ok && out.package);
    const storage = new FakeStorage();
    await storage.WriteText("acme.a/1.0.0/model.json", JSON.stringify(out.package!.document));
    const resolved = await new StoragePackageSource(storage).resolve({ model: "acme.a", version: "1.0.0" });
    assert.deepEqual(resolved.document, out.package!.document);
});
