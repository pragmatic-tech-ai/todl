import { test } from "node:test";
import assert from "node:assert/strict";
import { ServiceProvider, FakeStorage, type IStorage } from "@pragmatic-tech-ai/todl-runtime";
import type { Position } from "vscode-languageserver-types";
import { SolutionLanguageService } from "../solution-language-service.js";
import { AnalysisEngineKey, type IAnalysisEngine } from "../i-analysis-engine.js";
import { AnalyzeKind, type AnalyzeRequest, type AnalyzeResponse } from "../../analysis/protocol.js";
import { SolutionManagerService } from "../../../solution-manager/engine/solution-manager-service.js";
import { Solution } from "../../../solution-manager/engine/solution.js";
import { ProjectType, type ProjectManifest } from "../../../package-manager/manifest.js";
import { PROJECT_MANIFEST_FILENAME } from "../../../project-services/core/project-factory.js";

// Fixtures over a real Solution + a real SolutionBaseResolver (resolved by the
// service), mirroring the Task-3 / Task-11 tests. Static helpers on a class — no
// free functions.
class Fixtures
{
    private static readonly ConsumerRoot = "file:///solution/consumer";
    public static readonly ConsumerUri = "file:///solution/consumer/model.todl";
    public static readonly OutsideUri = "file:///outside/x.todl";
    public static readonly Pos: Position = { line: 0, character: 11 };
    public static readonly Edit = "concept foo { }";
    private static readonly ConsumerId = "landscape";
    private static readonly ModelFileName = "model.todl";
    private static readonly MemberType = "library";

    // A consumer project with a manifest that binds nothing, so ResolveBasesFor
    // returns an empty (but real) warm base-set.
    public static ConsumerStorage(): IStorage
    {
        const manifest: ProjectManifest = { type: ProjectType.Library, name: Fixtures.ConsumerId, version: 1, id: Fixtures.ConsumerId };
        const storage = new FakeStorage(Fixtures.ConsumerRoot);
        storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(manifest));
        storage.WriteText(Fixtures.ModelFileName, "namespace lib { }");
        return storage;
    }

    // A ServiceProvider carrying a manager stub whose ActiveSolution is a real
    // Solution with one member rooted at the consumer storage. An optional engine
    // double is registered under AnalysisEngineKey.
    public static Provider(engine?: IAnalysisEngine): ServiceProvider
    {
        const solution = new Solution("S");
        const member = solution.AddMember(Fixtures.ConsumerId, Fixtures.MemberType);
        member.Storage = Fixtures.ConsumerStorage();
        const manager = { ActiveSolution: solution };
        const provider = new ServiceProvider();
        provider.registerInstance(SolutionManagerService.Key, manager as unknown as SolutionManagerService);
        if (engine !== undefined) provider.registerInstance(AnalysisEngineKey, engine);
        return provider;
    }
}

// Records whether each request carried Context.Bases, so the base-set gating can
// be asserted directly.
class SpyEngine implements IAnalysisEngine
{
    public readonly BasesSeen: boolean[] = [];

    public async Analyze(request: AnalyzeRequest): Promise<AnalyzeResponse>
    {
        this.BasesSeen.push(request.Context.Bases !== undefined);
        return { Kind: AnalyzeKind.Completion, Items: [] };
    }
}

test("CompletionsAt returns the engine result for an in-project document after DidChange", async () =>
{
    const svc = new SolutionLanguageService(Fixtures.Provider());
    svc.DidChange(Fixtures.ConsumerUri, Fixtures.Edit);

    const items = await svc.CompletionsAt(Fixtures.ConsumerUri, Fixtures.Pos);
    assert.ok(Array.isArray(items));

    const hover = await svc.HoverAt(Fixtures.ConsumerUri, Fixtures.Pos);
    assert.ok(hover === null || typeof hover === "object");
});

test("a request for a URI under no project root returns empty, does not throw", async () =>
{
    const svc = new SolutionLanguageService(Fixtures.Provider());
    assert.deepEqual(await svc.CompletionsAt(Fixtures.OutsideUri, Fixtures.Pos), []);
    assert.equal(await svc.HoverAt(Fixtures.OutsideUri, Fixtures.Pos), null);
});

test("the full base-set is sent when the project changed, then suppressed on the next same request", async () =>
{
    const spy = new SpyEngine();
    const svc = new SolutionLanguageService(Fixtures.Provider(spy));
    svc.DidChange(Fixtures.ConsumerUri, Fixtures.Edit);

    await svc.CompletionsAt(Fixtures.ConsumerUri, Fixtures.Pos);
    await svc.CompletionsAt(Fixtures.ConsumerUri, Fixtures.Pos);

    assert.deepEqual(spy.BasesSeen, [true, false]);
});
