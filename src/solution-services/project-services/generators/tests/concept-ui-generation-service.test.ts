import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import { compile } from "@pragmatic-tech-ai/mural/compiler";
import { check } from "../../../../compiler-services/api.js";
import { toJSON } from "../../../../compiler-services/emit/json.js";
import { ProjectType, type ProjectManifest } from "../../../package-manager/manifest.js";
import type { CompiledPackage } from "../../../../publish/publish.js";
import type { IProjectModelProvider, ProjectModel } from "../project-content-generator.js";
import { AppUiTemplate } from "../../../todl-build-system/html-bundle/app-ui-template.js";
import { AppViewModelGenerator } from "../app-view-model-generator.js";
import { ConceptListViewGenerator } from "../concept-list-view-generator.js";
import { ConceptFormGenerator } from "../concept-form-generator.js";
import { ConceptCrudViewModelGenerator } from "../concept-crud-view-model-generator.js";
import { ConceptUiGenerationService } from "../concept-ui-generation-service.js";

const MODEL = "namespace acme { concept Customer { name : string; nickname : string?; age : integer?; active : boolean?; } }";

class FakeModelProvider implements IProjectModelProvider
{
    public constructor(private readonly result: ProjectModel)
    {
    }

    public Compile(): Promise<ProjectModel>
    {
        return Promise.resolve(this.result);
    }

    public CompileLocal(): Promise<ProjectModel>
    {
        return Promise.resolve(this.result);
    }
}

class Fixture
{
    public static readonly Concept = "acme.Customer";
    private static readonly AppUiPath = "src/app.mu";
    private static readonly AppViewModelPath = "src/main.ts";
    private static readonly PristineMainBody = "// pristine scaffold body — only the first line is the marker\n";

    public static Manifest(): ProjectManifest
    {
        return { type: ProjectType.Architecture, name: "Customers", version: 1 };
    }

    public static Model(): IProjectModelProvider
    {
        const doc = toJSON(check([{ uri: "m.todl", text: MODEL }]).model);
        const pkg = { fullDocument: doc } as unknown as CompiledPackage;
        return new FakeModelProvider({ package: pkg, errors: [] });
    }

    public static Service(): ConceptUiGenerationService
    {
        return new ConceptUiGenerationService([
            new ConceptListViewGenerator(),
            new ConceptFormGenerator(),
            new ConceptCrudViewModelGenerator(),
        ]);
    }

    /** Seed the two app-root files with their pristine scaffold markers. */
    public static async SeedPristineAppRoot(project: FakeStorage): Promise<void>
    {
        await project.WriteText(Fixture.AppUiPath, AppUiTemplate.Render("Customers"));
        await project.WriteText(Fixture.AppViewModelPath, AppViewModelGenerator.PristineMarker + "\n" + Fixture.PristineMainBody);
    }

    public static Run(project: FakeStorage): ReturnType<ConceptUiGenerationService["GenerateFor"]>
    {
        return Fixture.Service().GenerateFor(project, Fixture.Manifest(), Fixture.Model(), Fixture.Concept);
    }
}

describe("concept UI generation service", () =>
{
    test("pristine project: concept files written AND app root rewritten to host the concept view", async () =>
    {
        const project = new FakeStorage();
        await Fixture.SeedPristineAppRoot(project);

        const result = await Fixture.Run(project);

        // The three per-concept files plus both app-root files were written.
        for (const path of [
            "src/ui/Customer/list.mu",
            "src/ui/Customer/form.mu",
            "src/ui/Customer/Customer-vm.ts",
            "src/app.mu",
            "src/main.ts",
        ])
        {
            assert.ok(result.Written.includes(path), `expected ${path} in Written`);
        }
        assert.deepEqual(result.Skipped, []);
        assert.deepEqual(result.Messages, []);

        // app.mu references the generated list/form dictionaries and hosts them by key.
        const appMu = await project.ReadText("src/app.mu");
        assert.ok(appMu.includes("import CustomerListView from \"./ui/Customer/list.mu.js\""));
        assert.ok(appMu.includes("import CustomerFormView from \"./ui/Customer/form.mu.js\""));
        assert.ok(appMu.includes("merge CustomerListView"));
        assert.ok(appMu.includes("merge CustomerFormView"));
        assert.ok(appMu.includes("ContentTemplate = @CustomerListTemplate"));
        assert.ok(appMu.includes("ContentTemplate = @CustomerFormTemplate"));
        assert.ok(appMu.includes("Border x:root [ Fill = @SurfaceBg ]"), "app root is a filled, scheme-tracking backdrop that stretches to the host");
        assert.ok(!appMu.includes(AppUiTemplate.PristineMarker), "rewritten app.mu is no longer pristine");

        // main.ts constructs the container VM from the model.
        const mainTs = await project.ReadText("src/main.ts");
        assert.ok(mainTs.includes("import { CustomerListVM } from \"./ui/Customer/Customer-vm.js\""));
        assert.ok(mainTs.includes("new CustomerListVM(model)"));
        assert.ok(mainTs.includes("public get Customer(): CustomerListVM"));

        // PROOF: the rewritten app root + the generated views all compile cleanly.
        for (const path of ["src/app.mu", "src/ui/Customer/list.mu", "src/ui/Customer/form.mu"])
        {
            const mu = await project.ReadText(path);
            assert.doesNotThrow(() => compile(mu), path);
        }
    });

    test("regeneration leaves existing generated files byte-identical and reports them skipped", async () =>
    {
        const project = new FakeStorage();
        await Fixture.SeedPristineAppRoot(project);
        await Fixture.Run(project);

        // A maker edits a generated file.
        const listPath = "src/ui/Customer/list.mu";
        const handEdited = "hand edited\n";
        await project.WriteText(listPath, handEdited);

        const again = await Fixture.Run(project);

        // WriteOnce preserved the edit and the file is reported skipped.
        assert.equal(await project.ReadText(listPath), handEdited);
        assert.ok(again.Skipped.includes(listPath));
        // The app root is already wired (non-pristine now), so it is skipped too.
        assert.ok(again.Skipped.includes("src/app.mu"));
        assert.ok(again.Skipped.includes("src/main.ts"));
        assert.deepEqual(again.Written, []);
    });

    test("hand-edited app.mu (marker absent): app root not rewritten, a warning is returned", async () =>
    {
        const project = new FakeStorage();
        // app.mu hand-edited (no pristine marker); main.ts still pristine.
        await project.WriteText("src/app.mu", "// my own application shell\nApplication { }\n");
        await project.WriteText("src/main.ts", AppViewModelGenerator.PristineMarker + "\n");

        const result = await Fixture.Run(project);

        // Concept files are still generated.
        assert.ok(result.Written.includes("src/ui/Customer/list.mu"));
        // App root is left untouched and reported skipped.
        assert.ok(result.Skipped.includes("src/app.mu"));
        assert.ok(result.Skipped.includes("src/main.ts"));
        assert.equal(await project.ReadText("src/app.mu"), "// my own application shell\nApplication { }\n");
        assert.ok(!result.Written.includes("src/app.mu"));
        assert.ok(!result.Written.includes("src/main.ts"));
        // A maker-facing warning explains how to reference the generated view.
        assert.equal(result.Messages.length, 1);
        assert.ok(result.Messages[0]!.includes("CustomerListView"));
        assert.ok(result.Messages[0]!.includes("CustomerListVM"));
    });
});
