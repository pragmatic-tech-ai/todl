import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage, ServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import { ProjectType, type ProjectManifest } from "../../../package-manager/manifest.js";
import { Severity } from "../../../build-system-core/diagnostic-sink.js";
import { DiagnosticSink } from "../../../build-system-core/diagnostic-sink.js";
import { ProjectEventsKey, ProjectEventKind } from "../../generators/project-events.js";
import { ProjectSystemComposer } from "../../composition/project-system-composer.js";
import { ArchitectureProjectFactory } from "../architecture-project-factory.js";
import { ArchitectureProjectMigration } from "../architecture-project-migration.js";

const OldAppPath = "generated/app.mu";
const NewAppPath = "src/app.mu";
const ModelPath = "generated/model.ts";
const MainPath = "src/main.ts";
const DataPath = "generated/data.ts";
const OldAppContent = "Application { StackPanel { /* the user's old UI */ } }";
const NewAppContent = "// hand-edited new app";
const ModelContent = "export interface Widget { label?: string }";
const ModelSource = "namespace acme { concept Widget { label : string?; } }";

class Fixture
{
    public static async OldLayout(): Promise<FakeStorage>
    {
        const project = new FakeStorage();
        await project.WriteText("model.todl", ModelSource);
        await project.WriteText(OldAppPath, OldAppContent);
        await project.WriteText(ModelPath, ModelContent);
        return project;
    }

    public static Manifest(): ProjectManifest
    {
        return { type: ProjectType.Architecture, name: "Test Architecture", version: 1, id: "test-architecture", packageVersion: "0.1.0" };
    }

    public static async Open(provider: ServiceProvider, project: FakeStorage): Promise<void>
    {
        await provider.getRequired(ProjectEventsKey).Raise({
            Kind: ProjectEventKind.Opened,
            ProjectType: ArchitectureProjectFactory.ProjectType,
            Project: project,
            Manifest: Fixture.Manifest(),
        });
    }
}

describe("ArchitectureProjectMigration.Run", () =>
{
    test("moves the old generated/app.mu to src/app.mu verbatim", async () =>
    {
        const project = await Fixture.OldLayout();

        await new ArchitectureProjectMigration().Run(project);

        assert.equal(await project.ReadText(NewAppPath), OldAppContent);
        assert.equal(await project.Exists(OldAppPath), false);
        assert.equal(await project.ReadText(ModelPath), ModelContent);
    });

    test("is idempotent: a second run changes nothing", async () =>
    {
        const project = await Fixture.OldLayout();
        const migration = new ArchitectureProjectMigration();

        await migration.Run(project);
        await migration.Run(project);

        assert.equal(await project.ReadText(NewAppPath), OldAppContent);
        assert.equal(await project.Exists(OldAppPath), false);
    });

    test("never clobbers: an existing src/app.mu and the old file are both left untouched, with a warning", async () =>
    {
        const project = await Fixture.OldLayout();
        await project.WriteText(NewAppPath, NewAppContent);
        const diagnostics = new DiagnosticSink();

        await new ArchitectureProjectMigration(diagnostics).Run(project);

        assert.equal(await project.ReadText(NewAppPath), NewAppContent);
        assert.equal(await project.ReadText(OldAppPath), OldAppContent);
        assert.equal(diagnostics.All().length, 1);
        assert.equal(diagnostics.All()[0]!.severity, Severity.Warning);
    });

    test("is a no-op when there is no generated/app.mu", async () =>
    {
        const project = new FakeStorage();
        await project.WriteText(NewAppPath, NewAppContent);

        await new ArchitectureProjectMigration().Run(project);

        assert.equal(await project.ReadText(NewAppPath), NewAppContent);
        assert.equal(await project.Exists(OldAppPath), false);
    });
});

describe("architecture migration on Opened (composed, before backfill)", () =>
{
    test("old layout: old UI lands in src/app.mu (not a fresh scaffold) and the rest is backfilled", async () =>
    {
        const provider = new ServiceProvider();
        ProjectSystemComposer.Compose(provider);
        const project = await Fixture.OldLayout();

        await Fixture.Open(provider, project);

        assert.equal(await project.ReadText(NewAppPath), OldAppContent, "migration must run before AppGenerator's backfill");
        assert.equal(await project.Exists(OldAppPath), false);
        assert.equal(await project.ReadText(ModelPath), ModelContent, "generated/model.ts intact");
        assert.ok(await project.Exists(MainPath), "src/main.ts backfilled");
        assert.ok(await project.Exists(DataPath), "generated/data.ts backfilled");
    });

    test("a second Opened is a no-op", async () =>
    {
        const provider = new ServiceProvider();
        ProjectSystemComposer.Compose(provider);
        const project = await Fixture.OldLayout();

        await Fixture.Open(provider, project);
        const main = await project.ReadText(MainPath);
        const data = await project.ReadText(DataPath);
        await Fixture.Open(provider, project);

        assert.equal(await project.ReadText(NewAppPath), OldAppContent);
        assert.equal(await project.Exists(OldAppPath), false);
        assert.equal(await project.ReadText(MainPath), main);
        assert.equal(await project.ReadText(DataPath), data);
    });

    test("a project already holding src/app.mu keeps it and the old file", async () =>
    {
        const provider = new ServiceProvider();
        ProjectSystemComposer.Compose(provider);
        const project = await Fixture.OldLayout();
        await project.WriteText(NewAppPath, NewAppContent);

        await Fixture.Open(provider, project);

        assert.equal(await project.ReadText(NewAppPath), NewAppContent);
        assert.equal(await project.ReadText(OldAppPath), OldAppContent);
    });
});
