import type { IBuildAction } from "../build-action.js";
import type { TodlBuildContext } from "../todl-build-context.js";
import type { ArtifactKey } from "../artifact-key.js";
import { Severity } from "../diagnostic-sink.js";
import { PresentationResourceEmitter } from "../../project-services/core/presentation-model.js";
import type { IPresentationBaker, BakeOptions } from "../../project-services/core/presentation-baker.js";
import { NpmArtifacts } from "./npm-artifacts.js";

// A project content generator (spec §2, §11) that bakes the compiled model's
// presentation — SVG/raster icons into a self-contained presentation.compiled.json +
// icon-index — into the package output. Mural-coupled, so it runs the injected
// IPresentationBaker (the concrete baker lives host-side; todl owns only the seam) and
// is added by the host to the npm build system when a baker is available. It stamps the
// assigned resource keys onto the compiled document IN PLACE first, so — running before
// the emit action — those keys reach the written model.json and consumers link icon
// applications to the baked resources. A referenced icon with no readable project file is
// reported as an error, stopping the pipeline before promotion.
export class GeneratePresentationAction implements IBuildAction<TodlBuildContext>
{
    private static readonly ActionName = "generate-presentation";
    private static readonly OutputBase = "";
    private static readonly MissingIconPrefix = "missing icon file(s):";

    public readonly Name = GeneratePresentationAction.ActionName;
    public readonly Consumes: readonly ArtifactKey<unknown>[] = [NpmArtifacts.CompiledModel];
    public readonly Produces: readonly ArtifactKey<unknown>[] = [];

    constructor(
        private readonly baker: IPresentationBaker,
        private readonly options: BakeOptions,
    )
    {
    }

    public async Execute(ctx: TodlBuildContext): Promise<void>
    {
        const pkg = ctx.Artifacts.Get(NpmArtifacts.CompiledModel);
        if (pkg === undefined) return; // the compile gate did not produce a model

        // Write the assigned keys onto the shared document before the emit action serializes
        // it, so model.json carries them.
        PresentationResourceEmitter.StampResourceKeys(pkg.document);

        const result = await this.baker.Bake(ctx.Project, ctx.Sandbox, GeneratePresentationAction.OutputBase, pkg.document, this.options);
        if (!result.ok)
        {
            ctx.Diagnostics.Report({
                severity: Severity.Error,
                message: `${GeneratePresentationAction.MissingIconPrefix} ${result.missing.join(", ")}`,
                source: GeneratePresentationAction.ActionName,
            });
        }
    }
}
