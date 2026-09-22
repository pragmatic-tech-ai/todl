import { test } from "node:test";
import assert from "node:assert/strict";
import { BundleClosureCollector } from "../bundle-closure-collector.js";
import { compilePackage, PackageKind, type PackageRef } from "../../../../publish/publish.js";
import type { IPackageSource, SourcedPackage } from "../../package-source.js";
import type { ProjectBaseModelBindings } from "../../../project-services/core/base-binding.js";

// A build-tier source over compiled own-documents, keyed by id@version.
class MapSource implements IPackageSource
{
    constructor(private readonly byId: Map<string, SourcedPackage>) {}
    TryGet(ref: PackageRef): Promise<SourcedPackage | undefined>
    {
        return Promise.resolve(this.byId.get(`${ref.id}@${ref.version}`));
    }
}

test("collects the architecture + meta-model + both libraries", async () =>
{
    const meta = compilePackage([], [{ uri: "meta.todl", text: `namespace acme { concept Widget { name : string; } }` }], { id: "acme.meta", version: "1.0.0" });
    assert.ok(meta.ok && meta.package);
    const lib = (id: string, inst: string) => compilePackage(
        [meta.package!.fullDocument],
        [{ uri: `${id}.todl`, text: `namespace acme { model M : acme { Widget ${inst} { name = "${inst}"; } } }` }],
        { id, version: "1.0.0" },
        [{ kind: PackageKind.Library, id: "acme.meta", version: "1.0.0" }],
    );
    const ms = lib("acme.ms", "msWidget"); const aws = lib("acme.aws", "awsWidget");
    assert.ok(ms.ok && aws.ok && ms.package && aws.package);

    const arch = compilePackage(
        [meta.package!.fullDocument],
        [{ uri: "arch.todl", text: `namespace acme { model M : acme { Widget appWidget { name = "app"; } } }` }],
        { id: "acme.arch", version: "0.1.0" },
        [
            { kind: PackageKind.MetaModel, id: "acme.meta", version: "1.0.0" },
            { kind: PackageKind.Library, id: "acme.ms", version: "1.0.0" },
            { kind: PackageKind.Library, id: "acme.aws", version: "1.0.0" },
        ],
    );
    assert.ok(arch.ok && arch.package);

    const sourced = (doc: { nodes: unknown[] }, deps: PackageRef[]): SourcedPackage => ({ Document: doc as never, Dependencies: deps });
    const map = new Map<string, SourcedPackage>([
        ["acme.meta@1.0.0", sourced(meta.package!.document, [])],
        ["acme.ms@1.0.0", sourced(ms.package!.document, [{ kind: PackageKind.MetaModel, id: "acme.meta", version: "1.0.0" }])],
        ["acme.aws@1.0.0", sourced(aws.package!.document, [{ kind: PackageKind.MetaModel, id: "acme.meta", version: "1.0.0" }])],
    ]);
    const bindings: ProjectBaseModelBindings = {
        metaModels: [{ id: "acme.meta", version: "1.0.0" }],
        libraries: [{ id: "acme.ms", version: "1.0.0" }, { id: "acme.aws", version: "1.0.0" }],
    };

    const { packages, entry, problems } = await BundleClosureCollector.Collect(new MapSource(map), bindings, arch.package!);
    assert.deepEqual(problems, []);
    assert.deepEqual(entry, { model: "acme.arch", version: "0.1.0" });
    assert.deepEqual(packages.map((p) => p.ref.model).sort(), ["acme.arch", "acme.aws", "acme.meta", "acme.ms"]);
});

test("reports a problem for an unresolvable binding", async () =>
{
    const arch = compilePackage([], [{ uri: "arch.todl", text: `namespace acme { concept App {} }` }], { id: "acme.arch", version: "0.1.0" });
    assert.ok(arch.ok && arch.package);
    const bindings: ProjectBaseModelBindings = { libraries: [{ id: "acme.missing", version: "1.0.0" }] };
    const { problems } = await BundleClosureCollector.Collect(new MapSource(new Map()), bindings, arch.package!);
    assert.equal(problems.length, 1);
    assert.match(problems[0]!, /acme\.missing@1\.0\.0/);
});
