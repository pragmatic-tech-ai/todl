import { test } from "node:test";
import assert from "node:assert/strict";
import { ServiceProvider, FakeStorage, Signal, type IStorage } from "@pragmatic-tech-ai/todl-runtime";
import { SolutionLanguageService } from "../solution-language-service.js";
import { SolutionManagerService } from "../../../solution-manager/engine/solution-manager-service.js";
import { SolutionBaseResolver } from "../../../solution-manager/engine/solution-base-resolver.js";
import { Solution } from "../../../solution-manager/engine/solution.js";
import { type SolutionMember } from "../../../solution-manager/engine/solution-member.js";
import { type IComposedMemberSet } from "../../../solution-manager/engine/composed-members.js";
import { ProjectType, type ProjectManifest } from "../../../package-manager/manifest.js";
import { PROJECT_MANIFEST_FILENAME } from "../../../project-services/core/project-factory.js";

class UnionSet implements IComposedMemberSet
{
    public readonly Changed: Signal<void> = new Signal<void>();

    constructor(private readonly solutions: readonly Solution[])
    {
    }

    public Members(): readonly SolutionMember[]
    {
        return this.solutions.flatMap(s => s.Members.ToArray());
    }
}

// Two solutions: A holds the meta-model, B holds a library bound to it (a
// cross-solution base reference). Drives the REAL SolutionManagerService seam.
class CompositionWorld
{
    private static readonly MetaId = "tech-architecture";
    private static readonly LibId = "microsoft";
    private static readonly Version = "1.0.0";
    private static readonly MetaSource = "namespace ea { concept App { note : string?; } }";
    private static readonly LibSource = "namespace lib { import ea; taxonomy MS : represents App { term azure { } } }";
    private static readonly SolutionAName = "A";
    private static readonly SolutionBName = "B";
    private static readonly PromptKeyName = "prompts";

    public readonly Manager: SolutionManagerService;
    public readonly Service: SolutionLanguageService;
    public readonly Resolver: SolutionBaseResolver;
    public readonly A: Solution;
    public readonly B: Solution;

    constructor()
    {
        const provider = new ServiceProvider();
        provider.registerInstance(SolutionManagerService.StorageRegistryKey, { CreateStorage: (f: string) => new FakeStorage(f) } as never);
        provider.registerInstance(SolutionManagerService.ProjectFactoryRegistryKey, { factoryFor: () => undefined, All: () => [] } as never);
        provider.registerInstance(SolutionManagerService.PromptServiceKey, { [CompositionWorld.PromptKeyName]: true } as never);
        provider.registerInstance(SolutionManagerService.PackageSourceKey, { resolve: async () => undefined } as never);
        this.Manager = new SolutionManagerService(provider);
        provider.registerInstance(SolutionManagerService.Key, this.Manager);

        this.A = new Solution(CompositionWorld.SolutionAName);
        this.A.AddMember(CompositionWorld.MetaId, ProjectType.MetaModel).Storage = CompositionWorld.Storage("mm", "meta.todl", CompositionWorld.MetaSource,
            { type: ProjectType.MetaModel, name: CompositionWorld.MetaId, version: 1, id: CompositionWorld.MetaId, packageVersion: CompositionWorld.Version });
        this.B = new Solution(CompositionWorld.SolutionBName);
        this.B.AddMember(CompositionWorld.LibId, ProjectType.Library).Storage = CompositionWorld.Storage("lib", "lib.todl", CompositionWorld.LibSource,
            {
                type: ProjectType.Library, name: CompositionWorld.LibId, version: 1, id: CompositionWorld.LibId, packageVersion: CompositionWorld.Version,
                metaModels: [{ id: CompositionWorld.MetaId, version: CompositionWorld.Version }],
            });
        this.Resolver = new SolutionBaseResolver(provider);
        provider.registerInstance(SolutionBaseResolver.Key, this.Resolver);
        this.Service = new SolutionLanguageService(provider);
    }

    public static get MetaIdValue(): string
    {
        return CompositionWorld.MetaId;
    }

    public static get LibIdValue(): string
    {
        return CompositionWorld.LibId;
    }

    public async Assemble(): Promise<{ id: string }[]>
    {
        return (await (this.Service as unknown as { AssembleMembers(): Promise<{ id: string }[]> }).AssembleMembers());
    }

    private static Storage(root: string, file: string, source: string, manifest: ProjectManifest): IStorage
    {
        const storage = new FakeStorage(root);
        storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(manifest));
        storage.WriteText(file, source);
        return storage;
    }
}

test("composed provider: AssembleMembers yields the union of both solutions", async () =>
{
    const world = new CompositionWorld();
    world.Manager.SetComposedMemberSet(new UnionSet([world.A, world.B]));
    const ids = (await world.Assemble()).map(m => m.id).sort();
    assert.deepEqual(ids, [CompositionWorld.LibIdValue, CompositionWorld.MetaIdValue].sort());
});

test("composed provider: a cross-solution producer is visible to WorkspaceProducers", async () =>
{
    const world = new CompositionWorld();
    world.Manager.SetComposedMemberSet(new UnionSet([world.A, world.B]));
    const metas = await world.Resolver.WorkspaceProducers(ProjectType.MetaModel);
    assert.deepEqual(metas.map(r => r.id), [CompositionWorld.MetaIdValue]);
    const libs = await world.Resolver.WorkspaceProducers(ProjectType.Library);
    assert.deepEqual(libs.map(r => r.id), [CompositionWorld.LibIdValue]);
});

test("regression: with no provider, assembly is exactly the active solution's members in order", async () =>
{
    const world = new CompositionWorld();
    (world.Manager as unknown as { setActive(s: Solution | undefined): void }).setActive(world.B);
    const ids = (await world.Assemble()).map(m => m.id);
    assert.equal(ids.length, 1);
    assert.equal(ids[0], CompositionWorld.LibIdValue);
    const metas = await world.Resolver.WorkspaceProducers(ProjectType.MetaModel);
    assert.equal(metas.length, 0);
});
