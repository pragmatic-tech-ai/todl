/**
 * The concept-aware generator contract. Unlike the auto-scheduled, concept-less
 * `IProjectContentGenerator`, these generators are command-driven and scoped to one
 * target concept carried on the context.
 */

import type { IStorage } from "@pragmatic-tech-ai/todl-runtime";
import { fromJSON } from "../../../compiler-services/emit/json.js";
import type { ProjectManifest } from "../../package-manager/manifest.js";
import { ConceptUiModel } from "./concept-ui-model.js";
import type { GeneratorResult, IProjectModelProvider, WritePolicy } from "./project-content-generator.js";
import { WritePolicyWriter } from "./write-policy-writer.js";

export interface ConceptGeneratorContext
{
    readonly Project: IStorage;
    readonly Manifest: ProjectManifest;
    readonly Model: IProjectModelProvider;
    readonly Concept: string;
}

export interface IConceptUiGenerator
{
    readonly Id: string;
    readonly WritePolicy: WritePolicy;
    Generate(ctx: ConceptGeneratorContext): Promise<GeneratorResult>;
}

/** Shared plumbing for concept UI generators: model loading and policy-aware writing. */
export class ConceptUiGeneratorSupport
{
    private static readonly NoModelMessage = "no compiled model to generate concept UI from";
    private static readonly ErrorSeparator = "; ";

    /** Compiles the project and builds the UI model for the context's concept. */
    public static async LoadModel(ctx: ConceptGeneratorContext): Promise<ConceptUiModel>
    {
        const model = await ctx.Model.CompileLocal();
        if (model.package === undefined)
        {
            const detail = model.errors.length > 0 ? model.errors.join(ConceptUiGeneratorSupport.ErrorSeparator) : ConceptUiGeneratorSupport.NoModelMessage;
            throw new Error(detail);
        }
        return ConceptUiModel.For(fromJSON(model.package.fullDocument), ctx.Concept);
    }

    public static async WriteOne(ctx: ConceptGeneratorContext, path: string, body: string, policy: WritePolicy): Promise<GeneratorResult>
    {
        const wrote = await WritePolicyWriter.Write(ctx.Project, path, body, policy);
        return wrote ? { Written: [path], Skipped: [] } : { Written: [], Skipped: [path] };
    }
}
