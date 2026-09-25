import { test } from "node:test";
import assert from "node:assert/strict";
import { CompositionRoot, FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import type { IProjectFactory } from "../../solution-services/project-services/core/project-factory.js";
import { type IGeneratingProjectFactory } from "../../solution-services/project-services/core/project-factory.js";
import {
    type IProjectContentGenerator,
    type GeneratorContext,
    type GeneratorResult,
    GeneratorTrigger,
    WritePolicy,
} from "../../solution-services/project-services/generators/project-content-generator.js";
import { ProjectGeneratorRegistryKey } from "../../solution-services/project-services/generators/project-generator-registry.js";
import { ProjectEventsKey, ProjectEventKind } from "../../solution-services/project-services/generators/project-events.js";
import { ProjectType, type ProjectManifest } from "../../solution-services/package-manager/manifest.js";
import { GeneratorRegistryContribution } from "../generator-registry-contribution.js";

const ArchitectureTypeId = "architecture";
const LibraryTypeId = "library";
const FirstGeneratorId = "g1";
const SecondGeneratorId = "g2";

// A fake generator recording each run into a shared array; ignores ctx.
function MakeFakeGenerator(
    id: string,
    triggers: readonly GeneratorTrigger[],
    produces: readonly string[],
    ran: string[]): IProjectContentGenerator
{
    return {
        Id: id,
        DisplayName: id,
        Produces: produces,
        Triggers: triggers,
        WritePolicy: WritePolicy.Overwrite,
        Generate: async (_ctx: GeneratorContext): Promise<GeneratorResult> =>
        {
            ran.push(id);
            return { Written: [], Skipped: [] };
        },
    };
}

// A fake IProjectFactory & IGeneratingProjectFactory declaring one generator for
// "architecture". Only the members Contribute()/providesGenerators() touch are real.
function MakeFakeFactory(typeId: string, generators: readonly IProjectContentGenerator[]): IProjectFactory & IGeneratingProjectFactory
{
    return {
        typeId,
        title: typeId,
        description: typeId,
        formats: [],
        createProject: () => Promise.reject(new Error("not used")),
        openProject: () => Promise.reject(new Error("not used")),
        saveProject: () => Promise.reject(new Error("not used")),
        Generators: () => generators,
    };
}

function MakeManifest(): ProjectManifest
{
    return { type: ProjectType.Architecture, name: "x", version: 1 };
}

test("GeneratorRegistryContribution", async (t) =>
{
    await t.test("registry populated from factory-declared + build-registered generators", () =>
    {
        const ran: string[] = [];
        const g1 = MakeFakeGenerator(FirstGeneratorId, [GeneratorTrigger.ProjectCreated], ["generated/x"], ran);
        const g2 = MakeFakeGenerator(SecondGeneratorId, [GeneratorTrigger.ProjectCreated], ["generated/y"], ran);
        const factory = MakeFakeFactory(ArchitectureTypeId, [g1]);
        const contribution = new GeneratorRegistryContribution(
            [factory],
            { Extra: [{ ProjectType: LibraryTypeId, Generator: g2 }] });
        const root = new CompositionRoot();

        contribution.Contribute(root);

        const registry = root.Provider.getRequired(ProjectGeneratorRegistryKey);
        assert.deepEqual(registry.For(ArchitectureTypeId), [g1]);
        assert.deepEqual(registry.For(LibraryTypeId), [g2]);
    });

    await t.test("events raised on ProjectEventsKey reach a factory-declared generator via the scheduler", async () =>
    {
        const ran: string[] = [];
        const g1 = MakeFakeGenerator(FirstGeneratorId, [GeneratorTrigger.ProjectCreated], ["generated/x"], ran);
        const factory = MakeFakeFactory(ArchitectureTypeId, [g1]);
        const contribution = new GeneratorRegistryContribution([factory]);
        const root = new CompositionRoot();

        contribution.Contribute(root);

        const events = root.Provider.getRequired(ProjectEventsKey);
        await events.Raise({
            Kind: ProjectEventKind.Created,
            ProjectType: ArchitectureTypeId,
            Project: new FakeStorage(),
            Manifest: MakeManifest(),
        });

        assert.deepEqual(ran, [FirstGeneratorId]);
    });
});
