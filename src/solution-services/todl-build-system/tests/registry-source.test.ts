import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createTgz, type TarEntry } from "../../package-manager/registry/tar.js";
import type {
    IPackageRegistry,
    PackageRef as RegistryRef,
    VersionList,
    PackageManifestJson,
    PublishablePackage,
    ConnectionStatus,
} from "../../package-manager/engine/package-registry.js";
import { PackageKind, type PackageDocument, type PackageRef } from "../../../publish/publish.js";
import { RegistrySource } from "../registry-source.js";

const encoder = new TextEncoder();

// Build a published-package tarball (package/package.json with a todl block +
// package/model.json) the way publish lays one out, so RegistrySource exercises the
// real TarReader path.
function tarballFor(name: string, document: PackageDocument): Uint8Array
{
    const entries: TarEntry[] = [
        { path: "package/package.json", bytes: encoder.encode(JSON.stringify({ name, version: "1.0.0", todl: { id: "x", kind: "library" } })) },
        { path: "package/model.json", bytes: encoder.encode(JSON.stringify(document)) },
    ];
    return createTgz(entries);
}

// A registry serving pre-baked tarballs keyed by npm name; a miss throws, exactly as
// the HTTP backend does on a 404, so RegistrySource's fall-through is exercised.
class FakeRegistry implements IPackageRegistry
{
    private readonly served = new Map<string, Uint8Array>();

    public Serve(name: string, bytes: Uint8Array): void
    {
        this.served.set(name, bytes);
    }

    public GetContent(ref: RegistryRef): Promise<Uint8Array>
    {
        const bytes = this.served.get(ref.name);
        if (bytes === undefined) return Promise.reject(new Error(`404: ${ref.name}`));
        return Promise.resolve(bytes);
    }

    public ListPackages(): Promise<string[]> { return Promise.resolve([...this.served.keys()]); }
    public ListVersions(): Promise<VersionList> { return Promise.resolve({ versions: [], distTags: {} }); }
    public GetManifest(): Promise<PackageManifestJson> { return Promise.reject(new Error("not used")); }
    public Publish(_pkg: PublishablePackage): Promise<void> { return Promise.reject(new Error("not used")); }
    public DeleteVersion(): Promise<void> { return Promise.reject(new Error("not used")); }
    public Test(): Promise<ConnectionStatus> { return Promise.resolve({ Ok: true, Message: "ok" }); }
}

function ref(id: string, version = "1.0.0"): PackageRef
{
    return { kind: PackageKind.Library, id, version };
}

describe("RegistrySource", () =>
{
    test("fetches a package by mapping its bare id to the scoped npm name", async () =>
    {
        const doc: PackageDocument = {
            nodes: [{ id: "n1", type: "concept" } as never],
            edges: [],
            dependencies: [{ kind: PackageKind.MetaModel, id: "mm", version: "0.1.0" }],
        };
        const registry = new FakeRegistry();
        registry.Serve("@pragmatic-tech-ai/microsoft", tarballFor("@pragmatic-tech-ai/microsoft", doc));
        const source = new RegistrySource(registry);

        const pkg = await source.TryGet(ref("microsoft"));

        assert.notEqual(pkg, undefined);
        assert.deepEqual(pkg!.Document.nodes, doc.nodes);
        assert.deepEqual(pkg!.Dependencies, doc.dependencies);
    });

    test("honours a custom scope", async () =>
    {
        const doc: PackageDocument = { nodes: [], edges: [] };
        const registry = new FakeRegistry();
        registry.Serve("@acme/widgets", tarballFor("@acme/widgets", doc));
        const source = new RegistrySource(registry, "@acme");

        assert.notEqual(await source.TryGet(ref("widgets")), undefined);
    });

    test("a package the registry does not serve resolves to undefined (fall through)", async () =>
    {
        const source = new RegistrySource(new FakeRegistry());
        assert.equal(await source.TryGet(ref("missing")), undefined);
    });

    test("records no dependencies when the document declares none", async () =>
    {
        const registry = new FakeRegistry();
        registry.Serve("@pragmatic-tech-ai/leaf", tarballFor("@pragmatic-tech-ai/leaf", { nodes: [], edges: [] }));
        const source = new RegistrySource(registry);

        const pkg = await source.TryGet(ref("leaf"));
        assert.deepEqual(pkg!.Dependencies, []);
    });
});
