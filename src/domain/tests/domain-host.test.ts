import { test } from "node:test";
import assert from "node:assert/strict";
import { DomainHost } from "../domain-host.js";
import { PackagesContributor } from "../contributor.js";
import { MemoryPackageSource } from "../memory-package-source.js";
import { compilePackage, PackageKind } from "../../publish/publish.js";
import { PackageManifestBridge } from "../../solution-services/package-manager/package-manifest-bridge.js";
import type { ResolvedPackage } from "../domain.js";

// A shared meta-model concept, plus two libraries each instantiating it.
function fixtures(): ResolvedPackage[]
{
    const meta = compilePackage(
        [],
        [{ uri: "meta.todl", text: `namespace acme { concept Widget { name : string; } }` }],
        { id: "acme.meta", version: "1.0.0" },
    );
    assert.ok(meta.ok && meta.package);
    const lib = (id: string, inst: string) =>
    {
        const out = compilePackage(
            [meta.package!.fullDocument],
            [{ uri: `${id}.todl`, text: `namespace acme { model M : acme { Widget ${inst} { name = "${inst}"; } } }` }],
            { id, version: "1.0.0" },
            [{ kind: PackageKind.Library, id: "acme.meta", version: "1.0.0" }],
        );
        assert.ok(out.ok && out.package, `${id} compiles`);
        return PackageManifestBridge.toResolved(out.package!);
    };
    return [PackageManifestBridge.toResolved(meta.package!), lib("acme.ms", "msWidget"), lib("acme.aws", "awsWidget")];
}

test("composes a shared meta-model + two libraries; Query sees concepts and instances from all", async () =>
{
    const source = new MemoryPackageSource(fixtures());
    const host = await DomainHost.Compose([
        new PackagesContributor([source], [
            { model: "acme.ms", version: "1.0.0" },
            { model: "acme.aws", version: "1.0.0" },
        ]),
    ]);
    assert.deepEqual(host.Diagnostics, []);

    const query = host.Query();
    assert.ok(query.Concepts().some((t) => t.name === "Widget"), "meta-model concept present");
    const instances = query.InstancesOf("Widget").map((m) => m.node.id).sort();
    assert.deepEqual(instances, ["awsWidget", "msWidget"], "instances from BOTH libraries");
    assert.equal(query.Search("msWidget").length, 1);
});

test("an unresolvable library yields one diagnostic, not a throw; siblings still compose", async () =>
{
    const source = new MemoryPackageSource(fixtures());
    const host = await DomainHost.Compose([
        new PackagesContributor([source], [
            { model: "acme.ms", version: "1.0.0" },
            { model: "acme.missing", version: "1.0.0" },
        ]),
    ]);
    assert.equal(host.Diagnostics.length, 1);
    assert.match(host.Diagnostics[0]!.message, /acme\.missing/);
    assert.notEqual(host.Domain.getManifest("acme.ms"), undefined);
});
