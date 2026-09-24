import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import { TodlProjectBuildManager } from "../../todl-project-build-manager.js";
import { TodlBuildSystemRegistry } from "../../todl-build-system-registry.js";
import { HtmlBundleBuildSystem } from "../html-bundle-build-system.js";
import { FakeStorageProvider, EmptyPackageSource } from "../../tests/fakes.js";
import { parseManifest, ProjectType } from "../../../package-manager/manifest.js";
import { compilePackage, PackageKind, type PackageRef } from "../../../../publish/publish.js";
import type { IPackageSource, SourcedPackage } from "../../package-source.js";
import { Base64 } from "../../../../graph-api/browser/base64.js";

async function archProject(): Promise<FakeStorage>
{
    const storage = new FakeStorage();
    await storage.WriteText("project.plexus", JSON.stringify({
        type: "architecture", name: "my-arch", version: 1, id: "my-arch", packageVersion: "0.1.0",
    }));
    await storage.WriteText("model.todl", "namespace acme { concept App { label : string?; } model M : acme { App a1 { label = \"A1\"; } } }");
    return storage;
}

describe("HtmlBundleBuildSystem", () =>
{
    test("applies to architecture projects only", () =>
    {
        const system = new HtmlBundleBuildSystem();
        assert.equal(system.AppliesTo({ type: "architecture", name: "a", version: 1 } as never), true);
        assert.equal(system.AppliesTo({ type: "meta-model", name: "m", version: 1 } as never), false);
        assert.equal(system.AppliesTo({ type: "library", name: "l", version: 1 } as never), false);
    });

    test("the registry offers html-bundle for architecture, not for meta-model", () =>
    {
        const registry = new TodlBuildSystemRegistry();
        assert.equal(registry.For({ type: ProjectType.Architecture, name: "a" } as never).some((s) => s.Id === "html-bundle"), true);
        assert.equal(registry.For({ type: ProjectType.MetaModel, name: "m" } as never).some((s) => s.Id === "html-bundle"), false);
    });

    test("emits a self-contained index.html with the model + app bundle inlined", async () =>
    {
        const project = await archProject();
        const manifest = parseManifest(await project.ReadText("project.plexus"));
        const provider = new FakeStorageProvider();
        const manager = new TodlProjectBuildManager(new TodlBuildSystemRegistry(), provider);

        const { Result: result } = await manager.Build({ Project: project, Manifest: manifest, BuildSystemId: "html-bundle", Source: new EmptyPackageSource() });
        assert.equal(result.Ok, true, JSON.stringify(result.Diagnostics));

        const html = await provider.Output.ReadText("index.html");
        assert.match(html, /id="todl-app-root"/);
        assert.match(html, /__TODL_APP__/);
        assert.match(html, /MuralBundledHost/);           // the mural host bundle is inlined
        assert.match(html, /"root"/);                      // the root model id is present
        assert.match(html, /App/);                         // the compiled document is inlined (my-arch's concept)
    });

    test("inlines dependency resource bytes (base64) into the page", async () =>
    {
        // A meta-model carrying a resource, served through a build source.
        const meta = compilePackage([], [{ uri: "meta.todl", text:
            `namespace acme { concept Widget { name : string; } }` }], { id: "acme.meta", version: "1.0.0" });
        assert.ok(meta.ok && meta.package);
        const svg = new Uint8Array([104, 105]); // base64 "aGk="
        class MetaSource implements IPackageSource
        {
            public TryGet(ref: PackageRef): Promise<SourcedPackage | undefined>
            {
                if (ref.id !== "acme.meta") return Promise.resolve(undefined);
                return Promise.resolve({ Document: meta.package!.document, Dependencies: [],
                    resources: [{ path: "resources/w.svg", bytes: svg }] });
            }
        }

        const project = new FakeStorage();
        await project.WriteText("project.plexus", JSON.stringify({
            type: "architecture", name: "arch2", version: 1, id: "arch2", packageVersion: "0.1.0",
            metaModels: [{ id: "acme.meta", version: "1.0.0" }],
        }));
        await project.WriteText("model.todl", `namespace acme { model M : acme { Widget w1 { name = "W1"; } } }`);
        const manifest = parseManifest(await project.ReadText("project.plexus"));
        const provider = new FakeStorageProvider();
        const manager = new TodlProjectBuildManager(new TodlBuildSystemRegistry(), provider);

        const { Result: result } = await manager.Build({ Project: project, Manifest: manifest, BuildSystemId: "html-bundle", Source: new MetaSource() });
        assert.equal(result.Ok, true, JSON.stringify(result.Diagnostics));

        const html = await provider.Output.ReadText("index.html");
        assert.match(html, /"resources"/);
        assert.match(html, /acme\.meta\/1\.0\.0\/resources\/w\.svg/);
        assert.ok(html.includes(Base64.Encode(svg)), "the resource bytes are base64-inlined");
    });
});
