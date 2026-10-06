import { test } from "node:test";
import assert from "node:assert/strict";
import { ServiceProvider, FakeStorage, type IStorage } from "@pragmatic-tech-ai/todl-runtime";
import { SolutionLanguageService } from "../solution-language-service.js";
import { SolutionManagerService } from "../../../solution-manager/engine/solution-manager-service.js";
import { Solution } from "../../../solution-manager/engine/solution.js";
import { ProjectType, type ProjectManifest } from "../../../package-manager/manifest.js";
import { PROJECT_MANIFEST_FILENAME } from "../../../project-services/core/project-factory.js";

// A META / LIB / ARCH solution over FakeStorage, each member rooted at a distinct bare
// URI so the full source URI (root + relative path) matches the SolutionGraph fixtures.
// META is the only meta-model; LIB binds it and carries an icon'd taxonomy term; ARCH
// binds LIB and declares the model under test. Static helpers on one class — no free
// functions.
class World
{
    private static readonly MetaId = "tech-architecture";
    private static readonly LibId = "microsoft";
    private static readonly ArchName = "arch";
    private static readonly Version = "1.0.0";
    private static readonly ModelFile = "a.todl";
    private static readonly MetaFile = "meta.todl";
    private static readonly LibFile = "lib.todl";

    private static readonly MetaSource = "namespace ea { concept App { note : string?; } }";
    private static readonly LibSource =
        'namespace lib { import ea; taxonomy MS : represents App { term azure { annotate icon { path = "resources/azure.svg"; } } } }';
    private static readonly ArchSource = 'namespace app { import ea; model M : ea { App a { note = "x"; } } }';

    public readonly Service: SolutionLanguageService;
    public readonly Meta: IStorage;
    public readonly Lib: IStorage;
    public readonly Arch: IStorage;

    constructor()
    {
        this.Meta = World.Storage("mm", World.MetaFile, World.MetaSource,
            { type: ProjectType.MetaModel, name: World.MetaId, version: 1, id: World.MetaId, packageVersion: World.Version });
        this.Lib = World.Storage("lib", World.LibFile, World.LibSource,
            {
                type: ProjectType.Library, name: World.LibId, version: 1, id: World.LibId, packageVersion: World.Version,
                metaModels: [{ id: World.MetaId, version: World.Version }],
            });
        this.Arch = World.Storage("arch", World.ModelFile, World.ArchSource,
            {
                type: ProjectType.Architecture, name: World.ArchName, version: 1,
                libraries: [{ id: World.LibId, version: World.Version }],
            });
        const solution = new Solution("S");
        solution.AddMember(World.MetaId, ProjectType.MetaModel).Storage = this.Meta;
        solution.AddMember(World.LibId, ProjectType.Library).Storage = this.Lib;
        solution.AddMember(World.ArchName, ProjectType.Architecture).Storage = this.Arch;
        const provider = new ServiceProvider();
        provider.registerInstance(SolutionManagerService.Key, { ActiveSolution: solution } as unknown as SolutionManagerService);
        this.Service = new SolutionLanguageService(provider);
    }

    private static Storage(root: string, file: string, source: string, manifest: ProjectManifest): IStorage
    {
        const storage = new FakeStorage(root);
        storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(manifest));
        storage.WriteText(file, source);
        return storage;
    }
}

test("DidChange to a member replaces its slice and fires GraphChanged", async () =>
{
    const world = new World();
    await world.Service.Ready();

    let fired: string[] = [];
    world.Service.GraphChanged.subscribe((c) => { fired = [...c.memberIds]; });

    world.Service.DidChange("arch/a.todl", 'namespace app { import ea; model M : ea { App a { note = "y"; } } }');
    await world.Service.Flush();

    const view = await world.Service.ModelView(world.Arch);
    assert.equal(view?.model.attr("app.a", "note"), "y");
    assert.ok(fired.includes("arch"), `GraphChanged should fire with "arch"; fired = ${JSON.stringify(fired)}`);
});

test("ModelView returns the shared graph for a member and undefined for a non-member", async () =>
{
    const world = new World();
    await world.Service.Ready();

    const fromArch = await world.Service.ModelView(world.Arch);
    const fromLib = await world.Service.ModelView(world.Lib);
    assert.ok(fromArch !== undefined && fromLib !== undefined);
    // The SAME Repository instance for every consumer in the solution.
    assert.equal(fromArch.model, fromLib.model);
    assert.ok(fromArch.model.has("app.M"));

    assert.equal(await world.Service.ModelView(new FakeStorage("outside")), undefined);
});

test("Resources through the service resolves an icon annotation to its source member storage", async () =>
{
    const world = new World();
    await world.Service.Ready();

    const res = world.Service.Resources("lib.MS.azure");
    assert.equal(res.length, 1);
    assert.equal(res[0]!.path, "resources/azure.svg");
    assert.equal(res[0]!.storage, world.Lib);
});
