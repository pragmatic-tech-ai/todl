/**
 * Orchestrates the per-concept UI generators (Task 5 list + form, Task 6 CRUD
 * view-model) under their WriteOnce policy for one chosen concept, then — on a fresh
 * project only — wires the app root so the generated UI actually renders.
 *
 * App-root ruling (controller-approved, Option C): the generated `list.mu`/`form.mu`
 * are referenceable ResourceDictionaries (a keyed DataTemplate each), so the app root
 * REFERENCES them rather than inlining a dead copy — the generated files stay the live,
 * editable source of the UI. On the FIRST generation, when `src/app.mu` AND `src/main.ts`
 * still carry their pristine scaffold markers, the service rewrites both to merge the two
 * dictionaries and host them (by key) through `ContentPresenter`s bound to a
 * `new <Class>ListVM(model)` the app view-model constructs. If either file has been
 * hand-edited (marker absent), the app root is left untouched, reported in `Skipped`, and
 * a message tells the maker how to reference the generated view themselves.
 */

import type { IStorage } from "@pragmatic-tech-ai/todl-runtime";
import type { ProjectManifest } from "../../package-manager/manifest.js";
import type { GeneratorResult, IProjectModelProvider } from "./project-content-generator.js";
import { ConceptUiGeneratorSupport, type ConceptGeneratorContext, type IConceptUiGenerator } from "./concept-ui-generator.js";
import { AppNaming } from "./app-naming.js";
import { AppUiTemplate } from "../../todl-build-system/html-bundle/app-ui-template.js";
import { AppViewModelGenerator } from "./app-view-model-generator.js";

/** A `GeneratorResult` plus any maker-facing messages the orchestration raised. */
export interface ConceptGenerationResult extends GeneratorResult
{
    readonly Messages: readonly string[];
}

export class ConceptUiGenerationService
{
    private static readonly AppUiPath = "src/app.mu";
    private static readonly AppViewModelPath = "src/main.ts";
    private static readonly Newline = "\n";
    private static readonly CarriageReturn = "\r";

    // Tokens shared by both app-root rewrite templates.
    private static readonly AppClassToken = "{AppClass}";
    private static readonly ClassToken = "{Class}";
    private static readonly ListVmToken = "{ListVM}";
    private static readonly ListViewToken = "{ListView}";
    private static readonly FormViewToken = "{FormView}";
    private static readonly ListKeyToken = "{ListKey}";
    private static readonly FormKeyToken = "{FormKey}";

    private static readonly AppUiRewrite =
        "// src/app.mu — hosts the generated {Class} view (list + form). Edit freely.\n" +
        "import {AppClass} from \"./main.js\"\n" +
        "import {ListView} from \"./ui/{Class}/list.mu.js\"\n" +
        "import {FormView} from \"./ui/{Class}/form.mu.js\"\n\n" +
        "Application\n" +
        "{\n" +
        "    resources:\n" +
        "    {\n" +
        "        merge {ListView}\n" +
        "        merge {FormView}\n\n" +
        "        ContentPresenter x:root [ Content = $service({AppClass}) ]\n\n" +
        "        DataTemplate [ DataType = {AppClass} ]\n" +
        "        {\n" +
        "            StackPanel [ Orientation = Vertical, Margin = (16,16,16,16) ]\n" +
        "            {\n" +
        "                ContentPresenter [ Content = ${Class}, ContentTemplate = @{ListKey} ]\n" +
        "                ContentPresenter [ Content = ${Class}, ContentTemplate = @{FormKey} ]\n" +
        "            }\n" +
        "        }\n" +
        "    }\n" +
        "}\n";

    private static readonly AppViewModelRewrite =
        "// src/main.ts — application view-model hosting the generated {Class} view.\n" +
        "import { Application } from \"@pragmatic-tech-ai/mural\";\n" +
        "import { Observable } from \"@pragmatic-tech-ai/mural/runtime\";\n" +
        "import { model } from \"../generated/data.js\";\n" +
        "import { {ListVM} } from \"./ui/{Class}/{Class}-vm.js\";\n\n" +
        "export class {AppClass} extends Observable\n" +
        "{\n" +
        "    private readonly view: {ListVM};\n\n" +
        "    constructor()\n" +
        "    {\n" +
        "        super();\n" +
        "        Application.current?.Services.addInstance(this);\n" +
        "        this.view = new {ListVM}(model);\n" +
        "    }\n\n" +
        "    public get {Class}(): {ListVM}\n" +
        "    {\n" +
        "        return this.view;\n" +
        "    }\n" +
        "}\n";

    private static readonly HandEditedMessage =
        "src/app.mu and src/main.ts are hand-edited, so the app root was left untouched. " +
        "To show the generated {Class} view, merge {ListView} and {FormView} into your app " +
        "resources and host @{ListKey} and @{FormKey} on ContentPresenters whose Content is a " +
        "new {ListVM}(model).";

    public constructor(private readonly generators: readonly IConceptUiGenerator[])
    {
    }

    public async GenerateFor(
        project: IStorage, manifest: ProjectManifest,
        model: IProjectModelProvider, concept: string): Promise<ConceptGenerationResult>
    {
        const ctx: ConceptGeneratorContext = { Project: project, Manifest: manifest, Model: model, Concept: concept };
        const ui = await ConceptUiGeneratorSupport.LoadModel(ctx);
        const className = ui.ClassName;
        const appClass = AppNaming.AppClass(manifest.id ?? manifest.name);

        const written: string[] = [];
        const skipped: string[] = [];
        for (const generator of this.generators)
        {
            const result = await generator.Generate(ctx);
            written.push(...result.Written);
            skipped.push(...result.Skipped);
        }

        const messages: string[] = [];
        if (await this.AppRootIsPristine(project))
        {
            await project.WriteText(ConceptUiGenerationService.AppUiPath, this.RenderAppUi(className, appClass));
            await project.WriteText(ConceptUiGenerationService.AppViewModelPath, this.RenderAppViewModel(className, appClass));
            written.push(ConceptUiGenerationService.AppUiPath, ConceptUiGenerationService.AppViewModelPath);
        }
        else
        {
            skipped.push(ConceptUiGenerationService.AppUiPath, ConceptUiGenerationService.AppViewModelPath);
            messages.push(this.RenderHandEditedMessage(className));
        }

        return { Written: written, Skipped: skipped, Messages: messages };
    }

    /** True only when BOTH app-root files still carry their pristine scaffold first-line marker. */
    private async AppRootIsPristine(project: IStorage): Promise<boolean>
    {
        const appPristine = await this.FirstLineMatches(project, ConceptUiGenerationService.AppUiPath, AppUiTemplate.PristineMarker);
        const mainPristine = await this.FirstLineMatches(project, ConceptUiGenerationService.AppViewModelPath, AppViewModelGenerator.PristineMarker);
        return appPristine && mainPristine;
    }

    private async FirstLineMatches(project: IStorage, path: string, marker: string): Promise<boolean>
    {
        if (!await project.Exists(path))
        {
            return false;
        }
        const text = await project.ReadText(path);
        const firstLine = text.split(ConceptUiGenerationService.Newline)[0] ?? "";
        const normalized = firstLine.endsWith(ConceptUiGenerationService.CarriageReturn)
            ? firstLine.slice(0, -1)
            : firstLine;
        return normalized === marker;
    }

    private RenderAppUi(className: string, appClass: string): string
    {
        return this.FillAppClass(this.FillViewNames(ConceptUiGenerationService.AppUiRewrite, className), appClass);
    }

    private RenderAppViewModel(className: string, appClass: string): string
    {
        return this.FillAppClass(this.FillViewNames(ConceptUiGenerationService.AppViewModelRewrite, className), appClass);
    }

    /** The warning references only the generated view + VM names — no app class — so it fills the
     *  view-name tokens alone, keeping the general filler free of an empty-argument sentinel. */
    private RenderHandEditedMessage(className: string): string
    {
        return this.FillViewNames(ConceptUiGenerationService.HandEditedMessage, className);
    }

    private FillViewNames(template: string, className: string): string
    {
        return template
            .split(ConceptUiGenerationService.ListVmToken).join(AppNaming.ListViewModel(className))
            .split(ConceptUiGenerationService.ListViewToken).join(AppNaming.ListViewDictionary(className))
            .split(ConceptUiGenerationService.FormViewToken).join(AppNaming.FormViewDictionary(className))
            .split(ConceptUiGenerationService.ListKeyToken).join(AppNaming.ListTemplateKey(className))
            .split(ConceptUiGenerationService.FormKeyToken).join(AppNaming.FormTemplateKey(className))
            .split(ConceptUiGenerationService.ClassToken).join(className);
    }

    private FillAppClass(template: string, appClass: string): string
    {
        return template.split(ConceptUiGenerationService.AppClassToken).join(appClass);
    }
}
