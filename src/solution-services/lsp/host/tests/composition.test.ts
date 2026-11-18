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

interface AssembledMember
{
    id: string;
    baseIds: readonly string[];
    publishedBases: readonly unknown[];
}

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
    private static readonly SolutionCName = "C";
    private static readonly ArchName = "arch";
    private static readonly ArchSource = "namespace app { import ea; model M : ea { App a { } } }";

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
        provider.registerInstance(SolutionManagerService.PromptServiceKey, {} as never);
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

    public static get ArchNameValue(): string
    {
        return CompositionWorld.ArchName;
    }

    public static get LibIdValue(): string
    {
        return CompositionWorld.LibId;
    }

    public async Assemble(): Promise<AssembledMember[]>
    {
        return (await (this.Service as unknown as { AssembleMembers(): Promise<AssembledMember[]> }).AssembleMembers());
    }

    // One solution holding meta -> lib -> arch in insertion order (each binds the previous).
    public ThreeMemberSolution(): Solution
    {
        const solution = new Solution(CompositionWorld.SolutionCName);
        solution.AddMember(CompositionWorld.MetaId, ProjectType.MetaModel).Storage = CompositionWorld.Storage("mm3", "meta.todl", CompositionWorld.MetaSource,
            { type: ProjectType.MetaModel, name: CompositionWorld.MetaId, version: 1, id: CompositionWorld.MetaId, packageVersion: CompositionWorld.Version });
        solution.AddMember(CompositionWorld.LibId, ProjectType.Library).Storage = CompositionWorld.Storage("lib3", "lib.todl", CompositionWorld.LibSource,
            {
                type: ProjectType.Library, name: CompositionWorld.LibId, version: 1, id: CompositionWorld.LibId, packageVersion: CompositionWorld.Version,
                metaModels: [{ id: CompositionWorld.MetaId, version: CompositionWorld.Version }],
            });
        solution.AddMember(CompositionWorld.ArchName, ProjectType.Architecture).Storage = CompositionWorld.Storage("arch3", "a.todl", CompositionWorld.ArchSource,
            {
                type: ProjectType.Architecture, name: CompositionWorld.ArchName, version: 1,
                libraries: [{ id: CompositionWorld.LibId, version: CompositionWorld.Version }],
            });
        return solution;
    }

    private static Storage(root: string, file: string, source: string, manifest: ProjectManifest): IStorage
    {
        const storage = new FakeStorage(root);
        storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(manifest));
        storage.WriteText(file, source);
        return storage;
    }
}

test("composed provider: AssembleMembers yields the union and the cross-solution base is a local producer", async () =>
{
    const world = new CompositionWorld();
    world.Manager.SetComposedMemberSet(new UnionSet([world.A, world.B]));
    const members = await world.Assemble();
    assert.deepEqual(members.map(m => m.id), [CompositionWorld.MetaIdValue, CompositionWorld.LibIdValue]);
    const lib = members.find(m => m.id === CompositionWorld.LibIdValue)!;
    assert.deepEqual([...lib.baseIds], [CompositionWorld.MetaIdValue]);
    assert.equal(lib.publishedBases.length, 0);
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
    (world.Manager as unknown as { setActive(s: Solution | undefined): void }).setActive(world.ThreeMemberSolution());
    const members = await world.Assemble();
    assert.deepEqual(members.map(m => m.id), [CompositionWorld.MetaIdValue, CompositionWorld.LibIdValue, CompositionWorld.ArchNameValue]);
    assert.deepEqual(members.map(m => [...m.baseIds]), [[], [CompositionWorld.MetaIdValue], [CompositionWorld.LibIdValue]]);
    assert.deepEqual(members.map(m => m.publishedBases.length), [0, 0, 0]);
});
