import { test, describe } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import assert from "node:assert/strict";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import { BuildArtifacts } from "../../../build-system-core/build-artifacts.js";
import { BuildSystemRegistry } from "../../../build-system-core/build-system-registry.js";
import { DiagnosticSink, Severity } from "../../../build-system-core/diagnostic-sink.js";
import type { BuildOptions } from "../../../build-system-core/build-options.js";
import { HtmlBundleBuildSystem } from "../html-bundle-build-system.js";
import { EsbuildBundler } from "../node/esbuild-bundler.js";
import type { ITypeChecker, TypeCheckResult } from "../../../build-system-core/type-checker.js";
import { EmitBundledHostAction } from "../emit-bundled-host-action.js";
import { EmitRemoteDataAction } from "../emit-remote-data-action.js";
import { EmitRemoteEntryAction } from "../emit-remote-entry-action.js";
import { EmitRemoteHostAction } from "../emit-remote-host-action.js";
import { EmptyPackageSource } from "../../tests/fakes.js";
import { ProjectType } from "../../../package-manager/manifest.js";
import type { TodlBuildContext } from "../../todl-build-context.js";
import { NpmArtifacts } from "../../npm/npm-artifacts.js";
import { HtmlArtifacts } from "../html-artifacts.js";
import { compilePackage, PackageKind, type CompiledPackage, type PackageRef } from "../../../../publish/publish.js";
import { ResolveBasesAction } from "../../npm/resolve-bases-action.js";
import type { IPackageSource, SourcedPackage } from "../../package-source.js";

const SentinelBundle = "/*BUNDLE*/(()=>{})();";
const BundledFlavorId = "html-bundle";
const RemoteFlavorId = "html-bundle-remote";
const Remote = { AppName: "orders" };
const DevRemote = { ServerUrl: "https://srv.example.com/ws", Tenant: "acme", AppName: "orders" };

class NoopTypeChecker implements ITypeChecker
{
    public async Check(): Promise<TypeCheckResult>
    {
        return { Diagnostics: [] };
    }
}

class Fixture
{
    public static Context(options: BuildOptions): TodlBuildContext
    {
        return {
            Project: new FakeStorage(),
            Sandbox: new FakeStorage(),
            Artifacts: new BuildArtifacts(),
            Source: new EmptyPackageSource(),
            Manifest: { type: ProjectType.Architecture, name: "my-arch", version: 1, id: "my-arch" },
            Options: options,
            Diagnostics: new DiagnosticSink(),
        };
    }

    public static Compiled(): CompiledPackage
    {
        const outcome = compilePackage([], [{ uri: "model.todl", text:
            `namespace acme { concept App { label : string?; } model M : acme { App a1 { label = "A1"; } } }` }],
            { id: "my-arch", version: "0.1.0" });
        assert.ok(outcome.ok && outcome.package, JSON.stringify(outcome.diagnostics));
        return outcome.package!;
    }

    public static Ready(options: BuildOptions): TodlBuildContext
    {
        const ctx = Fixture.Context(options);
        ctx.Artifacts.Set(NpmArtifacts.CompiledModel, Fixture.Compiled());
        ctx.Artifacts.Set(HtmlArtifacts.AppBundle, SentinelBundle);
        ctx.Artifacts.Set(NpmArtifacts.ResolvedClosure, []);
        return ctx;
    }

    // Type-checks the emitted data.ts against the real engine + protocol typings (a stub DTO
    // stands in for the generated model.ts). Returns only diagnostics located in data.ts.
    public static TypeCheckEmitted(dataTs: string): string[]
    {
        const stage = mkdtempSync(join(tmpdir(), "todl-remote-data-"));
        try
        {
            const dataPath = join(stage, "data.ts");
            writeFileSync(dataPath, dataTs);
            writeFileSync(join(stage, "model.ts"),
                `import { ModelDataSource, type IModelDataConnector } from "@pragmatic-tech-ai/todl";\n` +
                `export class MyArch extends ModelDataSource { constructor(c?: IModelDataConnector) { super(c); } }\n`);
            const options: ts.CompilerOptions = {
                target: ts.ScriptTarget.ES2022,
                module: ts.ModuleKind.NodeNext,
                moduleResolution: ts.ModuleResolutionKind.NodeNext,
                lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.asynciterable.d.ts"],
                strict: true,
                noUncheckedIndexedAccess: true,
                exactOptionalPropertyTypes: true,
                skipLibCheck: true,
                noEmit: true,
                baseUrl: stage,
                paths: {
                    "@pragmatic-tech-ai/todl": [join(Fixture.TodlSrc, "index.ts")],
                    "@pragmatic-tech-ai/pragmatic-protocol/browser": [join(Fixture.ProtocolRoot, "dist", "browser.d.ts")],
                },
            };
            const program = ts.createProgram([dataPath], options);
            const wanted = [dataPath, join(stage, "model.ts")].map(f => Fixture.Normalize(f));
            return ts.getPreEmitDiagnostics(program)
                .filter(d => d.file !== undefined && wanted.includes(Fixture.Normalize(d.file.fileName)))
                .map(d => `${d.file!.fileName}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
        }
        finally
        {
            rmSync(stage, { recursive: true, force: true });
        }
    }

    private static Normalize(path: string): string
    {
        return path.split("\\").join("/").toLowerCase();
    }

    public static readonly TodlSrc = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
    public static readonly ProtocolRoot = join(Fixture.TodlSrc, "../../pragmatic-protocol");
}

class MapPackageSource implements IPackageSource
{
    private static readonly KeySeparator = "@";

    constructor(private readonly packages: ReadonlyMap<string, SourcedPackage>) {}

    public TryGet(ref: PackageRef): Promise<SourcedPackage | undefined>
    {
        return Promise.resolve(this.packages.get(ref.id + MapPackageSource.KeySeparator + ref.version));
    }
}

describe("remote flavor package closure", () =>
{
    const Prelude: PackageRef = { kind: PackageKind.Library, id: "prelude", version: "1.0.0" };
    const Shapes: PackageRef = { kind: PackageKind.Library, id: "shapes", version: "2.0.0" };
    const Doc = { nodes: [], edges: [] };

    test("emits model.json for the app and every transitive dependency; manifest lists exactly them", async () =>
    {
        const base = Fixture.Ready({ Remote });
        const ctx: TodlBuildContext =
        {
            ...base,
            Manifest: { ...base.Manifest, libraries: [{ id: "shapes", version: "2.0.0" }] },
            Source: new MapPackageSource(new Map<string, SourcedPackage>([
                ["shapes@2.0.0", { Document: Doc, Dependencies: [Prelude] }],
                ["prelude@1.0.0", { Document: Doc, Dependencies: [] }],
            ])),
        };
        await new ResolveBasesAction().Execute(ctx);
        assert.equal(ctx.Diagnostics.Count, 0, JSON.stringify(ctx.Diagnostics.All()));
        await new EmitRemoteHostAction().Execute(ctx);
        assert.equal(ctx.Diagnostics.Count, 0, JSON.stringify(ctx.Diagnostics.All()));
        const manifest = JSON.parse(await ctx.Sandbox.ReadText("servable-manifest.json"));
        assert.deepEqual(manifest.packages, [
            { id: "my-arch", version: "0.1.0" },
            { id: "shapes", version: "2.0.0" },
            { id: "prelude", version: "1.0.0" },
        ]);
        for (const p of manifest.packages)
        {
            const model = JSON.parse(await ctx.Sandbox.ReadText(`packages/${p.id}/${p.version}/model.json`));
            assert.ok(Array.isArray(model.nodes), p.id);
        }
        const shapes = JSON.parse(await ctx.Sandbox.ReadText("packages/shapes/2.0.0/model.json"));
        assert.deepEqual(shapes.dependencies, [Prelude], "dependency edges are carried in model.json");
        const compiled = ctx.Artifacts.Get(NpmArtifacts.CompiledModel)!;
        const appText = await ctx.Sandbox.ReadText("packages/my-arch/0.1.0/model.json");
        assert.ok(appText.endsWith("\n"), "trailing newline like the npm flavor");
        assert.deepEqual(JSON.parse(appText), JSON.parse(JSON.stringify(compiled.document)));
        assert.deepEqual(shapes, { ...Doc, dependencies: [Prelude] });
        assert.deepEqual(JSON.parse(await ctx.Sandbox.ReadText("packages/prelude/1.0.0/model.json")), Doc);
    });

    test("a diamond dependency (reached by two paths) is emitted exactly once", async () =>
    {
        const base = Fixture.Ready({ Remote });
        const ctx: TodlBuildContext =
        {
            ...base,
            Manifest: { ...base.Manifest, libraries: [{ id: "left", version: "1.0.0" }, { id: "right", version: "1.0.0" }] },
            Source: new MapPackageSource(new Map<string, SourcedPackage>([
                ["left@1.0.0", { Document: Doc, Dependencies: [Prelude] }],
                ["right@1.0.0", { Document: Doc, Dependencies: [Prelude] }],
                ["prelude@1.0.0", { Document: Doc, Dependencies: [] }],
            ])),
        };
        await new ResolveBasesAction().Execute(ctx);
        await new EmitRemoteHostAction().Execute(ctx);
        const manifest = JSON.parse(await ctx.Sandbox.ReadText("servable-manifest.json"));
        assert.deepEqual(manifest.packages.map((p: { id: string }) => p.id), ["my-arch", "left", "right", "prelude"]);
        // Even a closure artifact that lists a member twice must not duplicate it.
        ctx.Artifacts.Set(NpmArtifacts.ResolvedClosure, [
            { Ref: Prelude, Package: { Document: Doc, Dependencies: [] } },
            { Ref: Prelude, Package: { Document: Doc, Dependencies: [] } },
        ]);
        await new EmitRemoteHostAction().Execute(ctx);
        const again = JSON.parse(await ctx.Sandbox.ReadText("servable-manifest.json"));
        assert.deepEqual(again.packages.map((p: { id: string }) => p.id), ["my-arch", "prelude"]);
    });

    test("a missing ResolvedClosure is a build error and writes nothing servable", async () =>
    {
        const ctx = Fixture.Context({ Remote });
        ctx.Artifacts.Set(NpmArtifacts.CompiledModel, Fixture.Compiled());
        ctx.Artifacts.Set(HtmlArtifacts.AppBundle, SentinelBundle);
        await new EmitRemoteHostAction().Execute(ctx);
        assert.ok(ctx.Diagnostics.All().some(d => d.severity === Severity.Error));
        assert.equal(await ctx.Sandbox.Exists("servable-manifest.json"), false);
        assert.equal(await ctx.Sandbox.Exists("index.html"), false);
    });

    test("a project with no dependencies emits only its own model.json", async () =>
    {
        const ctx = Fixture.Ready({ Remote });
        await new EmitRemoteHostAction().Execute(ctx);
        assert.equal(await ctx.Sandbox.Exists("packages/my-arch/0.1.0/model.json"), true);
        const manifest = JSON.parse(await ctx.Sandbox.ReadText("servable-manifest.json"));
        assert.equal(manifest.packages.length, 1);
    });
});

describe("remote flavor registration", () =>
{
    test("html-bundle offers the bundled flavor first and a remote flavor second", () =>
    {
        const system = new HtmlBundleBuildSystem(new EsbuildBundler(), new NoopTypeChecker());
        const flavors = system.Flavors();
        assert.deepEqual(flavors.map(f => f.Id), [BundledFlavorId, RemoteFlavorId]);
        const remote = flavors[1]!;
        assert.equal(remote.OutputName, RemoteFlavorId);
        assert.ok(remote.Actions().some(a => a instanceof EmitRemoteDataAction));
        assert.ok(remote.Actions().some(a => a instanceof EmitRemoteEntryAction));
        assert.ok(remote.Actions().some(a => a instanceof EmitRemoteHostAction));
        assert.ok(!remote.Actions().some(a => a instanceof EmitBundledHostAction), "no inlined-snapshot host action");
        assert.ok(flavors[0]!.Actions().some(a => a instanceof EmitBundledHostAction), "bundled flavor unchanged");
        assert.ok(!remote.Requires.some(r => r.Path === "generated/data.ts"), "data.ts is shadowed, not required");
    });

    test("registration validates consume-before-produce for every flavor", () =>
    {
        const registry = new BuildSystemRegistry<TodlBuildContext, unknown>();
        assert.doesNotThrow(() => registry.Register(new HtmlBundleBuildSystem(new EsbuildBundler(), new NoopTypeChecker()) as never));
    });
});

describe("remote flavor emitters", () =>
{
    test("host page carries NO inlined snapshot payload but the bundle", async () =>
    {
        const ctx = Fixture.Ready({ Remote });
        await new EmitRemoteHostAction().Execute(ctx);
        assert.equal(ctx.Diagnostics.Count, 0, JSON.stringify(ctx.Diagnostics.All()));
        const html = await ctx.Sandbox.ReadText("index.html");
        assert.ok(!html.includes("__TODL_APP__"));
        assert.ok(html.includes(SentinelBundle));
        assert.ok(html.includes("todl-app-root"));
    });

    test("servable manifest matches the {name,version,packages,ui} shape", async () =>
    {
        const ctx = Fixture.Ready({ Remote });
        await new EmitRemoteHostAction().Execute(ctx);
        const manifest = JSON.parse(await ctx.Sandbox.ReadText("servable-manifest.json"));
        assert.equal(manifest.name, "orders");
        assert.equal(manifest.version, "0.1.0");
        assert.deepEqual(manifest.packages, [{ id: "my-arch", version: "0.1.0" }]);
        assert.equal(manifest.ui.entry, "index.html");
        assert.deepEqual(manifest.ui.assets, ["index.html"]);
    });

    test("generated data.ts uses RemoteTenantConnector over the cypher/query client, not the snapshot", async () =>
    {
        const ctx = Fixture.Ready({ Remote });
        await new EmitRemoteDataAction().Execute(ctx);
        assert.equal(ctx.Diagnostics.Count, 0, JSON.stringify(ctx.Diagnostics.All()));
        const src = await ctx.Sandbox.ReadText("generated/data.ts");
        assert.ok(src.includes("RemoteTenantConnector"));
        assert.ok(src.includes("BrowserSocketDialer"));
        assert.ok(src.includes("@pragmatic-tech-ai/pragmatic-protocol/browser"));
        assert.ok(src.includes("QueryAll"));
        assert.ok(src.includes("location.host"), "socket is derived from the serving origin at runtime");
        assert.ok(src.includes("UrlOverride: string | null = null"), "no baked absolute URL");
        assert.ok(!src.includes("tenant="), "the app sends no tenant");
        assert.ok(src.includes("\"orders\""));
        assert.ok(src.includes("new MyArch("), "constructs the DTO with the connector");
        assert.ok(!src.includes("__TODL_APP__"));
        assert.ok(!src.includes("fromJSON"));
        assert.ok(src.includes("acme.App"), "ontology schema is embedded");
        assert.ok(!src.includes("\"A1\""), "instance data is not embedded");
    });

    test("generated data.ts emits the tenant write adapter over WriteAppData", async () =>
    {
        const ctx = Fixture.Ready({ Remote });
        await new EmitRemoteDataAction().Execute(ctx);
        const src = await ctx.Sandbox.ReadText("generated/data.ts");
        assert.ok(src.includes("implements ITenantReadClient, ITenantWriteClient"));
        assert.ok(src.includes("WriteDocument("));
        assert.ok(src.includes("client.WriteAppData("));
        for (const k of ["Create", "Update", "Delete"]) assert.ok(src.includes(`[ConnectorWriteOpKind.${k}]: AppWriteOpKind.${k}`), k);
        for (const k of ["Applied", "Conflict", "Denied", "Invalid", "Failed"]) assert.ok(src.includes(`[AppWriteStatus.${k}]: ConnectorWriteStatus.${k}`), k);
        assert.ok(src.includes("new RemoteTenantConnector(client, client)"), "same instance for read and write");
        assert.ok(src.includes("private Connected(): Promise<PragmaticClient>"));
        assert.ok(src.includes("this.connecting = this.Connect();"), "the in-flight connect promise is cached");
        assert.equal(src.split("OpenApplication(").length - 1, 1, "OpenApplication is issued from one place only");
        assert.ok(src.includes("wire.id = op.Id"), "Id passes through to the wire op");
        assert.ok(src.includes("wire.fields = op.Fields"), "Fields pass through to the wire op");
        assert.ok(src.includes("mapped.Id = result.id"), "id passes back onto the result");
        assert.ok(src.includes("mapped.Reason = result.reason"), "reason passes back onto the result");
    });

    test("entry constructs the view-model synchronously, then awaits PrepareAndMount", async () =>
    {
        const ctx = Fixture.Ready({ Remote });
        await new EmitRemoteEntryAction().Execute(ctx);
        const src = await ctx.Sandbox.ReadText("entry.ts");
        assert.ok(src.includes("PrepareAndMount(app, model"));
        assert.ok(!src.includes("TodlAppBootstrap.Mount("));
        // The view-model MUST be constructed synchronously (and so registered in Application.current.Services)
        // before the async prepare, or the app.mu `$service` binding — which resolves once, within a microtask —
        // misses it and the view never binds.
        assert.ok(src.includes("new MyArchApp();"), "view-model is constructed synchronously");
        assert.ok(src.indexOf("new MyArchApp();") < src.indexOf("PrepareAndMount"), "view-model is constructed before PrepareAndMount");
        assert.equal(ctx.Artifacts.Get(HtmlArtifacts.AppEntry), "entry.ts");
    });

    test("missing Remote options (no AppName) is a Severity.Error and writes nothing", async () =>
    {
        const ctx = Fixture.Ready({});
        await new EmitRemoteDataAction().Execute(ctx);
        await new EmitRemoteHostAction().Execute(ctx);
        assert.ok(ctx.Diagnostics.All().filter(d => d.severity === Severity.Error).length >= 2);
        assert.equal(await ctx.Sandbox.Exists("generated/data.ts"), false);
        assert.equal(await ctx.Sandbox.Exists("index.html"), false);
    });

    test("remote pipeline places EmitRemoteData before BundleApp", () =>
    {
        const remote = new HtmlBundleBuildSystem(new EsbuildBundler(), new NoopTypeChecker()).Flavors()[1]!;
        const names = remote.Actions().map(a => a.constructor.name);
        assert.ok(names.indexOf("EmitRemoteDataAction") >= 0);
        assert.ok(names.indexOf("EmitRemoteDataAction") < names.indexOf("BundleAppAction"));
    });

    test("dev override bakes an absolute ws URL with the tenant", async () =>
    {
        const ctx = Fixture.Ready({ Remote: DevRemote });
        await new EmitRemoteDataAction().Execute(ctx);
        assert.equal(ctx.Diagnostics.Count, 0, JSON.stringify(ctx.Diagnostics.All()));
        const src = await ctx.Sandbox.ReadText("generated/data.ts");
        assert.ok(src.includes("wss://srv.example.com/ws?tenant=acme"));
    });

    test("an override with an unsupported scheme or garbage is a build diagnostic, not a throw", async () =>
    {
        for (const bad of ["ftp://x.example.com", "not a url"])
        {
            const ctx = Fixture.Ready({ Remote: { AppName: "orders", ServerUrl: bad } });
            await assert.doesNotReject(() => new EmitRemoteDataAction().Execute(ctx));
            assert.ok(ctx.Diagnostics.All().some(d => d.severity === Severity.Error), bad);
            assert.equal(await ctx.Sandbox.Exists("generated/data.ts"), false);
        }
    });

    test("the EMITTED data.ts type-checks against the real engine and protocol typings", async () =>
    {
        const ctx = Fixture.Ready({ Remote });
        await new EmitRemoteDataAction().Execute(ctx);
        const errors = Fixture.TypeCheckEmitted(await ctx.Sandbox.ReadText("generated/data.ts"));
        assert.deepEqual(errors, []);
    });

    test("the type-check helper really catches errors (negative control)", () =>
    {
        const errors = Fixture.TypeCheckEmitted("const x: number = 'not a number'; export {};");
        assert.ok(errors.length > 0);
    });

    test("bundled host still inlines the snapshot (no regression)", async () =>
    {
        const ctx = Fixture.Ready({});
        await new EmitBundledHostAction().Execute(ctx);
        const html = await ctx.Sandbox.ReadText("index.html");
        assert.ok(html.includes("window.__TODL_APP__ ="));
    });
});
