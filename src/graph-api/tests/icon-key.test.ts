import { test } from "node:test";
import assert from "node:assert/strict";
import { compilePackage, PackageKind } from "../../publish/publish.js";
import { PackageManifestBridge } from "../../solution-services/package-manager/package-manifest-bridge.js";
import { MemoryPackageSource } from "../../domain/memory-package-source.js";
import { DomainHost } from "../../domain/domain-host.js";
import { PackagesContributor } from "../../domain/contributor.js";

async function host()
{
    const meta = compilePackage([], [{ uri: "meta.todl", text:
        `namespace acme { concept Widget { name : string; annotate icon { path = "resources/w.svg"; } } }` }],
        { id: "acme.meta", version: "1.0.0" });
    assert.ok(meta.ok && meta.package);
    const aws = compilePackage([meta.package!.fullDocument],
        [{ uri: "aws.todl", text: `namespace acme { model M : acme { Widget awsWidget { name = "aws"; } } }` }],
        { id: "acme.aws", version: "1.0.0" },
        [{ kind: PackageKind.Library, id: "acme.meta", version: "1.0.0" }]);
    assert.ok(aws.ok && aws.package);
    const src = new MemoryPackageSource([
        PackageManifestBridge.toResolved(meta.package!), PackageManifestBridge.toResolved(aws.package!),
    ]);
    return DomainHost.Compose([new PackagesContributor([src], [{ model: "acme.aws", version: "1.0.0" }])]);
}

test("IconKey qualifies with the DECLARING package's model/version", async () =>
{
    const q = (await host()).Query();
    assert.equal(q.IconKey("Widget"), "acme.meta/1.0.0/resources/w.svg");
});

test("IconKey returns undefined for a type without an icon / unknown type", async () =>
{
    const q = (await host()).Query();
    assert.equal(q.IconKey("Element"), undefined);
    assert.equal(q.IconKey("Nonexistent"), undefined);
});
