import { test } from "node:test";
import { strictEqual, deepStrictEqual } from "node:assert";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import { DiagnosticSink } from "../../../build-system-core/diagnostic-sink.js";
import { ProjectType, type ProjectManifest } from "../../../package-manager/manifest.js";
import { type IProjectContentGenerator, type GeneratorContext, type IProjectModelProvider, type ProjectModel, GeneratorTrigger, WritePolicy } from "../project-content-generator.js";
import { ProjectGeneratorRegistry } from "../project-generator-registry.js";
import { type ProjectEvent, ProjectEventKind } from "../project-events.js";
import { GeneratorScheduler, type GeneratorContextFactory } from "../generator-scheduler.js";

const ArchitectureProjectType = ProjectType.Architecture;
const DtoGeneratorId = "dto";
const UiGeneratorId = "ui";
const DtoOutputPath = "generated/model.ts";
const UiOutputPath = "generated/app.mu";

class FakeModelProvider implements IProjectModelProvider
{
    public Compile(): Promise<ProjectModel>
    {
        return Promise.resolve({ errors: [] });
    }
}

function MakeFakeGenerator(id: string, triggers: readonly GeneratorTrigger[], produces: readonly string[], ran: string[]): IProjectContentGenerator
{
    return {
        Id: id,
        DisplayName: `Generator ${id}`,
        Produces: produces,
        Triggers: triggers,
        WritePolicy: WritePolicy.WriteOnce,
        Generate: async () =>
        {
            ran.push(id);
            return { Written: [], Skipped: [] };
        },
    };
}

function MakeManifest(): ProjectManifest
{
    return { type: ArchitectureProjectType, name: "x", version: 1 };
}

function MakeEvent(kind: ProjectEventKind, project: FakeStorage): ProjectEvent
{
    return { Kind: kind, ProjectType: ArchitectureProjectType, Project: project, Manifest: MakeManifest() };
}

function MakeContextFactory(project: FakeStorage): GeneratorContextFactory
{
    const model = new FakeModelProvider();
    const diagnostics = new DiagnosticSink();
    return (event: ProjectEvent, reason: GeneratorTrigger): GeneratorContext =>
    {
        return { Project: event.Project, Manifest: event.Manifest, Model: model, Diagnostics: diagnostics, Reason: reason };
    };
}

function MakeRegistry(ran: string[]): ProjectGeneratorRegistry
{
    const registry = new ProjectGeneratorRegistry();
    registry.Register(ArchitectureProjectType, MakeFakeGenerator(
        DtoGeneratorId,
        [GeneratorTrigger.ProjectCreated, GeneratorTrigger.ReferencesChanged],
        [DtoOutputPath],
        ran
    ));
    registry.Register(ArchitectureProjectType, MakeFakeGenerator(
        UiGeneratorId,
        [GeneratorTrigger.ProjectCreated],
        [UiOutputPath],
        ran
    ));
    return registry;
}

test("GeneratorScheduler.Handle", async (t) =>
{
    await t.test("Created runs every generator triggered by ProjectCreated", async () =>
    {
        const ran: string[] = [];
        const project = new FakeStorage();
        const scheduler = new GeneratorScheduler(MakeRegistry(ran), MakeContextFactory(project));

        await scheduler.Handle(MakeEvent(ProjectEventKind.Created, project));

        deepStrictEqual(ran, [DtoGeneratorId, UiGeneratorId]);
    });

    await t.test("ReferencesChanged runs only the generator triggered by it", async () =>
    {
        const ran: string[] = [];
        const project = new FakeStorage();
        const scheduler = new GeneratorScheduler(MakeRegistry(ran), MakeContextFactory(project));

        await scheduler.Handle(MakeEvent(ProjectEventKind.ReferencesChanged, project));

        deepStrictEqual(ran, [DtoGeneratorId]);
    });

    await t.test("Backfill-on-open runs only the generator whose output is missing (Review Focus)", async () =>
    {
        const ran: string[] = [];
        const project = new FakeStorage();
        await project.WriteText(DtoOutputPath, "// already generated");
        const scheduler = new GeneratorScheduler(MakeRegistry(ran), MakeContextFactory(project));

        await scheduler.Handle(MakeEvent(ProjectEventKind.Opened, project));

        deepStrictEqual(ran, [UiGeneratorId]);
    });

    await t.test("Saved runs no generator", async () =>
    {
        const ran: string[] = [];
        const project = new FakeStorage();
        const scheduler = new GeneratorScheduler(MakeRegistry(ran), MakeContextFactory(project));

        await scheduler.Handle(MakeEvent(ProjectEventKind.Saved, project));

        strictEqual(ran.length, 0);
    });
});
