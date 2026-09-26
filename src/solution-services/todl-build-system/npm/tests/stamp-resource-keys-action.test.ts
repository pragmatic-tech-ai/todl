import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import { BuildArtifacts } from "../../../build-system-core/build-artifacts.js";
import { DiagnosticSink } from "../../../build-system-core/diagnostic-sink.js";
import { EmptyPackageSource, libraryManifest } from "../../tests/fakes.js";
import type { TodlBuildContext } from "../../todl-build-context.js";
import { NpmArtifacts } from "../npm-artifacts.js";
import { StampResourceKeysAction } from "../stamp-resource-keys-action.js";
import type { CompiledPackage } from "../../../../publish/publish.js";

function contextWith(pkg: CompiledPackage | undefined): TodlBuildContext
{
    const artifacts = new BuildArtifacts();
    if (pkg !== undefined) artifacts.Set(NpmArtifacts.CompiledModel, pkg);
    return {
        Project: new FakeStorage(),
        Sandbox: new FakeStorage(),
        Artifacts: artifacts,
        Source: new EmptyPackageSource(),
        Manifest: libraryManifest(),
        Options: {},
        Diagnostics: new DiagnosticSink(),
    };
}

// A realistic own/full split (mirrors generate-presentation.test.ts's iconPkg fixture):
// the entity + its `@icon` application + the Annotated edge between them are own
// (authored in-project), while the `icon`/`MuralResource` annotation declarations + the
// `Extends` edge between them live only in the closure — same as the real prelude.
function iconPkg(): CompiledPackage
{
    const entityNode = { id: "app1", type: null, metaKind: "concept", attrs: {} };
    const iconNode = { id: "app1@icon", type: "icon", metaKind: null, attrs: { path: "visuals/a.svg" } };
    const ownEdges = [{ kind: "Annotated", from: "app1", to: "app1@icon" }];
    const ownNodes = [entityNode, iconNode];
    return {
        id: "microsoft",
        version: "1.0.0",
        document: { nodes: ownNodes, edges: ownEdges },
        fullDocument: {
            nodes: [
                ...ownNodes,
                { id: "icon", type: null, metaKind: "annotation", attrs: {} },
                { id: "MuralResource", type: null, metaKind: "annotation", attrs: {} },
            ],
            edges: [...ownEdges, { kind: "Extends", from: "icon", to: "MuralResource" }],
        },
        sources: [],
        classes: [],
    } as unknown as CompiledPackage;
}

// A package with no MuralResource-derived annotation applications at all — nothing for
// the emitter to detect, so the document must pass through untouched.
function plainPkg(): CompiledPackage
{
    const entityNode = { id: "app1", type: null, metaKind: "concept", attrs: {} };
    return {
        id: "microsoft",
        version: "1.0.0",
        document: { nodes: [entityNode], edges: [] },
        fullDocument: { nodes: [entityNode], edges: [] },
        sources: [],
        classes: [],
    } as unknown as CompiledPackage;
}

describe("StampResourceKeysAction", () =>
{
    test("stamps resource keys onto the package document when resources are declared", async () =>
    {
        const pkg = iconPkg();
        const ctx = contextWith(pkg);

        await new StampResourceKeysAction().Execute(ctx);

        const iconNode = pkg.document.nodes.find((n) => (n as unknown as { type: string | null }).type === "icon") as unknown as { attrs: Record<string, unknown> };
        assert.equal(typeof iconNode.attrs["key"], "string");
    });

    test("is a no-op when the project declares no resources", async () =>
    {
        const pkg = plainPkg();
        const ctx = contextWith(pkg);
        const before = JSON.stringify(pkg.document);

        await new StampResourceKeysAction().Execute(ctx);

        assert.equal(JSON.stringify(pkg.document), before);
    });

    test("is a no-op (no throw) when CompiledModel is absent", async () =>
    {
        const ctx = contextWith(undefined);

        await assert.doesNotReject(async () => new StampResourceKeysAction().Execute(ctx));
    });
});
