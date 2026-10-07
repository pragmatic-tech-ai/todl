import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import { BuildArtifacts } from "../../../build-system-core/build-artifacts.js";
import { DiagnosticSink, Severity } from "../../../build-system-core/diagnostic-sink.js";
import { BuildSystemRegistry } from "../../../build-system-core/build-system-registry.js";
import { EmptyPackageSource, FakeStorageProvider } from "../../tests/fakes.js";
import type { TodlBuildContext } from "../../todl-build-context.js";
import { TodlProjectBuildManager } from "../../todl-project-build-manager.js";
import { parseManifest, ProjectType, type ProjectManifest } from "../../../package-manager/manifest.js";
import { TarReader } from "../../../package-manager/registry/tar-reader.js";
import type {
    ConnectionStatus,
    IPackageRegistry,
    PackageManifestJson,
    PackageRef,
    PublishablePackage,
    RegistryInspection,
    VersionList,
} from "../../../package-manager/engine/package-registry.js";
import { NpmPackageBuildSystem } from "../npm-package-build-system.js";
import { PublishPackageAction } from "../publish-package-action.js";
import { FakePresentationBaker } from "../../../project-services/core/tests/fake-producer-seams.js";

// A fake IPackageRegistry that records every Publish call, so tests assert real
// behavior (what was published, how many times) rather than a mock that merely
// doesn't throw.
class FakeRegistry implements IPackageRegistry
{
    public readonly PublishCalls: PublishablePackage[] = [];

    public ListPackages(): Promise<string[]>
    {
        return Promise.resolve([]);
    }

    public ListVersions(_name: string): Promise<VersionList>
    {
        return Promise.resolve({ versions: [], distTags: {} });
    }

    public GetManifest(_ref: PackageRef): Promise<PackageManifestJson>
    {
        return Promise.reject(new Error("not implemented"));
    }

    public GetContent(_ref: PackageRef): Promise<Uint8Array>
    {
        return Promise.reject(new Error("not implemented"));
    }

    public Publish(pkg: PublishablePackage): Promise<void>
    {
        this.PublishCalls.push(pkg);
        return Promise.resolve();
    }

    public DeleteVersion(_name: string, _version: string): Promise<void>
    {
        return Promise.resolve();
    }

    public Test(): Promise<ConnectionStatus>
    {
        return Promise.resolve({ Ok: true, Message: "ok" });
    }

    public Inspect(): Promise<RegistryInspection>
    {
        return Promise.reject(new Error("not implemented"));
    }
}

function libraryManifest(): ProjectManifest
{
    return { type: ProjectType.Library, name: "demo-lib", version: 1, id: "demo-lib", packageVersion: "1.0.0" };
}

async function sandboxLayout(): Promise<FakeStorage>
{
    const sandbox = new FakeStorage();
    await sandbox.WriteText("package.json", JSON.stringify({ name: "demo-lib", version: "1.0.0" }));
    await sandbox.WriteText("model.json", JSON.stringify({ nodes: [], edges: [] }));
    await sandbox.WriteText("src/model.todl", "namespace acme {}");
    return sandbox;
}

function contextWith(sandbox: FakeStorage, registry: IPackageRegistry | undefined): TodlBuildContext
{
    return {
        Project: new FakeStorage(),
        Sandbox: sandbox,
        Artifacts: new BuildArtifacts(),
        Source: new EmptyPackageSource(),
        Manifest: libraryManifest(),
        Options: {},
        Diagnostics: new DiagnosticSink(),
        ...(registry !== undefined ? { PublishRegistry: registry } : {}),
    };
}

describe("PublishPackageAction", () =>
{
    test("with a registry: packs the sandbox and publishes exactly once", async () =>
    {
        const sandbox = await sandboxLayout();
        const registry = new FakeRegistry();
        const ctx = contextWith(sandbox, registry);

        await new PublishPackageAction().Execute(ctx);

        assert.equal(registry.PublishCalls.length, 1);
        const published = registry.PublishCalls[0]!;
        assert.deepEqual(published.Manifest, JSON.parse(await sandbox.ReadText("package.json")));
        assert.ok(published.Tarball.length > 0, "tarball is non-empty");
        const paths = TarReader.read(published.Tarball).map((f) => f.path).sort();
        assert.deepEqual(paths, ["package/model.json", "package/package.json", "package/src/model.todl"], "node:zlib reads the web-gzipped tarball");
        assert.equal(ctx.Diagnostics.Count, 0);
    });

    test("with PublishRegistry undefined: reports an error diagnostic, never publishes, writes nothing", async () =>
    {
        const sandbox = await sandboxLayout();
        const before = [...await sandbox.List("")];
        const ctx = contextWith(sandbox, undefined);

        await new PublishPackageAction().Execute(ctx);

        assert.equal(ctx.Diagnostics.Count, 1);
        const [diagnostic] = ctx.Diagnostics.All();
        assert.equal(diagnostic!.severity, Severity.Error);
        assert.match(diagnostic!.message, /no registry/);

        const after = [...await sandbox.List("")];
        assert.deepEqual(after, before, "the action wrote nothing to the sandbox");
    });
});

describe("NpmPackageBuildSystem — publish flavor", () =>
{
    test("exposes both a plain package flavor and a publish flavor over the same actions + PublishPackageAction", () =>
    {
        const system = new NpmPackageBuildSystem(new FakePresentationBaker());
        const [packageFlavor, publishFlavor] = system.Flavors();

        assert.equal(packageFlavor!.Id, "npm-package");
        assert.equal(publishFlavor!.Id, "npm-publish");
        assert.deepEqual(
            publishFlavor!.Actions().map((a) => a.Name),
            [...packageFlavor!.Actions().map((a) => a.Name), "publish-package"],
        );
    });

    async function metaProject(): Promise<FakeStorage>
    {
        const storage = new FakeStorage();
        await storage.WriteText("project.plexus", JSON.stringify({ type: "meta-model", name: "widgets", version: 1, id: "widgets", packageVersion: "0.1.0" }));
        await storage.WriteText("model.todl", "namespace acme { concept Widget { label : string?; } }");
        return storage;
    }

    test("the plain package flavor never touches an available PublishRegistry", async () =>
    {
        const project = await metaProject();
        const manifest = parseManifest(await project.ReadText("project.plexus"));
        const registry = new FakeRegistry();

        const buildRegistry = new BuildSystemRegistry<TodlBuildContext, ProjectManifest>();
        buildRegistry.Register(new NpmPackageBuildSystem(new FakePresentationBaker()));
        const provider = new FakeStorageProvider();
        const manager = new TodlProjectBuildManager(buildRegistry, provider);

        const { Result: result } = await manager.Build({
            Project: project,
            Manifest: manifest,
            BuildSystemId: "npm-package",
            BuildFlavorId: "npm-package",
            Source: new EmptyPackageSource(),
            PublishRegistry: registry,
        });

        assert.equal(result.Ok, true, JSON.stringify(result.Diagnostics));
        assert.equal(registry.PublishCalls.length, 0, "the plain flavor never calls Publish");
    });

    test("the publish flavor packs the promoted sandbox and publishes exactly once", async () =>
    {
        const project = await metaProject();
        const manifest = parseManifest(await project.ReadText("project.plexus"));
        const registry = new FakeRegistry();

        const buildRegistry = new BuildSystemRegistry<TodlBuildContext, ProjectManifest>();
        buildRegistry.Register(new NpmPackageBuildSystem(new FakePresentationBaker()));
        const provider = new FakeStorageProvider();
        const manager = new TodlProjectBuildManager(buildRegistry, provider);

        const { Result: result } = await manager.Build({
            Project: project,
            Manifest: manifest,
            BuildSystemId: "npm-package",
            BuildFlavorId: "npm-publish",
            Source: new EmptyPackageSource(),
            PublishRegistry: registry,
        });

        assert.equal(result.Ok, true, JSON.stringify(result.Diagnostics));
        assert.equal(registry.PublishCalls.length, 1);
        const publishedManifest = registry.PublishCalls[0]!.Manifest;
        const promotedManifest = JSON.parse(await provider.Output.ReadText("package.json"));
        assert.deepEqual(publishedManifest, promotedManifest);
    });

    test("the publish flavor with no PublishRegistry fails the build and promotes nothing", async () =>
    {
        const project = await metaProject();
        const manifest = parseManifest(await project.ReadText("project.plexus"));

        const buildRegistry = new BuildSystemRegistry<TodlBuildContext, ProjectManifest>();
        buildRegistry.Register(new NpmPackageBuildSystem(new FakePresentationBaker()));
        const provider = new FakeStorageProvider();
        const manager = new TodlProjectBuildManager(buildRegistry, provider);

        const { Result: result } = await manager.Build({
            Project: project,
            Manifest: manifest,
            BuildSystemId: "npm-package",
            BuildFlavorId: "npm-publish",
            Source: new EmptyPackageSource(),
        });

        assert.equal(result.Ok, false);
        assert.ok(result.Diagnostics.some((d) => /no registry/.test(d.message)));
        assert.equal(await provider.Output.Exists("package.json"), false, "nothing was promoted to the output");
    });
});
