import { test } from "node:test";
import assert from "node:assert/strict";
import { BundledDomainHost } from "../bundled-host.js";
import { compilePackage, PackageKind } from "../../../publish/publish.js";
import { PackageManifestBridge } from "../../../solution-services/package-manager/package-manifest-bridge.js";
import type { ResolvedPackage } from "../../../domain/domain.js";

function inlined(): ResolvedPackage[]
{
    const meta = compilePackage([], [{ uri: "meta.todl", text: `namespace acme { concept Widget { name : string; } }` }], { id: "acme.meta", version: "1.0.0" });
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
        return PackageManifestBridge.toResolvedJson(out.package!);
    };
    return [PackageManifestBridge.toResolvedJson(meta.package!), lib("acme.ms", "msWidget"), lib("acme.aws", "awsWidget")];
}

test("BundledDomainHost composes the inlined set; Query sees all packages", async () =>
{
    const host = new BundledDomainHost(inlined());
    await host.Compose([{ model: "acme.ms", version: "1.0.0" }, { model: "acme.aws", version: "1.0.0" }]);
    assert.deepEqual(host.Diagnostics, []);
    const query = host.Query();
    assert.ok(query.Concepts().some((c) => c.id === "Widget"));
    assert.deepEqual(query.InstancesOf("Widget").map((e) => e.id).sort(), ["awsWidget", "msWidget"]);
});
