import { test } from "node:test";
import assert from "node:assert/strict";
import { compilePackage } from "../../../publish/publish.js";
import { PackageManifestBridge } from "../package-manifest-bridge.js";
import { MemoryPackageSource } from "../../../domain/memory-package-source.js";
import { Domain } from "../../../domain/domain.js";

test("toResolvedJson yields a JSON manifest a Domain can load", async () =>
{
    const out = compilePackage([], [{ uri: "a.todl", text: `namespace acme { concept Widget { name : string; } }` }], { id: "acme.a", version: "1.0.0" });
    assert.ok(out.ok && out.package);
    const resolved = PackageManifestBridge.toResolvedJson(out.package!);

    // The manifest is plain JSON (survives a stringify round-trip), not a Uint8Array.
    assert.ok(!(resolved.manifest instanceof Uint8Array));
    assert.deepEqual(JSON.parse(JSON.stringify(resolved.manifest)), resolved.manifest);

    // A Domain loads it without throwing (Manifest.load accepts ManifestJson).
    const domain = new Domain(new MemoryPackageSource([resolved]));
    await domain.load({ model: "acme.a", version: "1.0.0" });
    assert.notEqual(domain.getManifest("acme.a"), undefined);
});
