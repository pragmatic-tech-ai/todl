import type { IBuildAction } from "../../build-system-core/build-action.js";
import type { TodlBuildContext } from "../todl-build-context.js";
import type { ArtifactKey } from "../../build-system-core/artifact-key.js";
import { Severity } from "../../build-system-core/diagnostic-sink.js";
import { PresentationResourceEmitter } from "../../project-services/core/presentation-model.js";
import type { IPresentationBaker, BakeOptions } from "../../project-services/core/presentation-baker.js";
import { ProjectType } from "../../package-manager/manifest.js";
import { NpmArtifacts } from "./npm-artifacts.js";

// A project content generator (spec §2, §11) that bakes the compiled model's
// presentation — SVG/raster icons into a self-contained presentation.compiled.json +
// icon-index — into the package output. Mural-coupled, so it runs the injected
// IPresentationBaker (the concrete baker lives host-side; the ctor takes `undefined`
// when the host has none, in which case this action skips cleanly rather than failing
// the build). Gated on the project actually declaring resources
// (`PresentationResourceEmitter.DeclaresResources`) and on the current project type
// having bake options at all — an architecture project has neither dict name nor icon
// prefix to bake with. Runs AFTER StampResourceKeysAction, which stamps the resource
// keys onto the shared document in place so model.json carries them; this action only
// bakes, it does not stamp. A referenced icon with no readable project file is reported
// as an error, stopping the pipeline before promotion.
export class BakeResourcesAction implements IBuildAction<TodlBuildContext>
{
    private static readonly ActionName = "bake-resources";
    private static readonly OutputBase = "";
    private static readonly MissingIconsMessage = "missing icon file(s): ";
    private static readonly MetaModelDictName = "MetaModelPresentation";
    private static readonly MetaModelIconPrefix = "mm:";
    private static readonly LibraryDictName = "LibraryPresentation";
    private static readonly LibraryIconPrefix = "";

    public readonly Name = BakeResourcesAction.ActionName;
    public readonly Consumes: readonly ArtifactKey<unknown>[] = [NpmArtifacts.CompiledModel];
    public readonly Produces: readonly ArtifactKey<unknown>[] = [];

    constructor(private readonly baker: IPresentationBaker | undefined)
    {
    }

    public async Execute(ctx: TodlBuildContext): Promise<void>
    {
        const pkg = ctx.Artifacts.Get(NpmArtifacts.CompiledModel);
        if (pkg === undefined) return; // the compile gate did not produce a model

        if (!PresentationResourceEmitter.DeclaresResources(pkg.document, pkg.fullDocument)) return;

        const options = this.OptionsFor(ctx.Manifest.type);
        if (options === undefined) return;

        if (this.baker === undefined) return; // no host baker supplied — skip cleanly

        const result = await this.baker.Bake(ctx.Project, ctx.Sandbox, BakeResourcesAction.OutputBase, pkg.document, options);
        if (!result.ok)
        {
            ctx.Diagnostics.Report({
                severity: Severity.Error,
                message: BakeResourcesAction.MissingIconsMessage + result.missing.join(", "),
                source: BakeResourcesAction.ActionName,
            });
        }
    }

    private OptionsFor(type: ProjectType): BakeOptions | undefined
    {
        switch (type)
        {
            case ProjectType.MetaModel:
                return { dictName: BakeResourcesAction.MetaModelDictName, iconPrefix: BakeResourcesAction.MetaModelIconPrefix };
            case ProjectType.Library:
                return { dictName: BakeResourcesAction.LibraryDictName, iconPrefix: BakeResourcesAction.LibraryIconPrefix };
            default:
                return undefined;
        }
    }
}
