import { test, describe } from "node:test";
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
import { compilePackage, type CompiledPackage } from "../../../../publish/publish.js";

const SentinelBundle = "/*BUNDLE*/(()=>{})();";
const BundledFlavorId = "html-bundle";
const RemoteFlavorId = "html-bundle-remote";
const Remote = { ServerUrl: "https://srv.example.com/ws", Tenant: "acme", AppName: "orders" };

class NoopTypeChecker implements ITypeChecker
{
    public async Check(): Promise<TypeCheckResult>
    {
        return { Diagnostics: [] };
    }
}

function contextWith(options: BuildOptions): TodlBuildContext
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

function compiledModelFixture(): CompiledPackage
{
    const outcome = compilePackage([], [{ uri: "model.todl", text:
        `namespace acme { concept App { label : string?; } model M : acme { App a1 { label = "A1"; } } }` }],
        { id: "my-arch", version: "0.1.0" });
    assert.ok(outcome.ok && outcome.package, JSON.stringify(outcome.diagnostics));
    return outcome.package!;
}

function readyContext(options: BuildOptions): TodlBuildContext
{
    const ctx = contextWith(options);
    ctx.Artifacts.Set(NpmArtifacts.CompiledModel, compiledModelFixture());
    ctx.Artifacts.Set(HtmlArtifacts.AppBundle, SentinelBundle);
    return ctx;
}

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
        const ctx = readyContext({ Remote });
        await new EmitRemoteHostAction().Execute(ctx);
        assert.equal(ctx.Diagnostics.Count, 0, JSON.stringify(ctx.Diagnostics.All()));
        const html = await ctx.Sandbox.ReadText("index.html");
        assert.ok(!html.includes("__TODL_APP__"));
        assert.ok(html.includes(SentinelBundle));
        assert.ok(html.includes("todl-app-root"));
    });

    test("servable manifest matches the {name,version,packages,ui} shape", async () =>
    {
        const ctx = readyContext({ Remote });
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
        const ctx = readyContext({ Remote });
        await new EmitRemoteDataAction().Execute(ctx);
        assert.equal(ctx.Diagnostics.Count, 0, JSON.stringify(ctx.Diagnostics.All()));
        const src = await ctx.Sandbox.ReadText("generated/data.ts");
        assert.ok(src.includes("RemoteTenantConnector"));
        assert.ok(src.includes("BrowserSocketDialer"));
        assert.ok(src.includes("@pragmatic-tech-ai/pragmatic-protocol/browser"));
        assert.ok(src.includes("QueryAll"));
        assert.ok(src.includes("wss://srv.example.com/ws?tenant=acme"));
        assert.ok(src.includes("\"orders\""));
        assert.ok(src.includes("new MyArch("), "constructs the DTO with the connector");
        assert.ok(!src.includes("__TODL_APP__"));
        assert.ok(!src.includes("fromJSON"));
        assert.ok(src.includes("acme.App"), "ontology schema is embedded");
        assert.ok(!src.includes("\"A1\""), "instance data is not embedded");
    });

    test("entry awaits PrepareAndMount instead of mounting synchronously", async () =>
    {
        const ctx = readyContext({ Remote });
        await new EmitRemoteEntryAction().Execute(ctx);
        const src = await ctx.Sandbox.ReadText("entry.ts");
        assert.ok(src.includes("PrepareAndMount(app, model"));
        assert.ok(!src.includes("TodlAppBootstrap.Mount("));
        assert.equal(ctx.Artifacts.Get(HtmlArtifacts.AppEntry), "entry.ts");
    });

    test("missing Remote options is a Severity.Error and writes nothing", async () =>
    {
        const ctx = readyContext({});
        await new EmitRemoteDataAction().Execute(ctx);
        await new EmitRemoteHostAction().Execute(ctx);
        assert.ok(ctx.Diagnostics.All().filter(d => d.severity === Severity.Error).length >= 2);
        assert.equal(await ctx.Sandbox.Exists("generated/data.ts"), false);
        assert.equal(await ctx.Sandbox.Exists("index.html"), false);
    });

    test("bundled host still inlines the snapshot (no regression)", async () =>
    {
        const ctx = readyContext({});
        await new EmitBundledHostAction().Execute(ctx);
        const html = await ctx.Sandbox.ReadText("index.html");
        assert.ok(html.includes("window.__TODL_APP__ ="));
    });
});
