import type { IBuildAction } from "../../build-system-core/build-action.js";
import type { TodlBuildContext } from "../todl-build-context.js";
import type { ArtifactKey } from "../../build-system-core/artifact-key.js";
import { PresentationResourceEmitter } from "../../project-services/core/presentation-model.js";
import { NpmArtifacts } from "./npm-artifacts.js";

// Stamps presentation resource keys onto the compiled model document as a build step
// (spec §2, §11), so the published model.json carries them for consumers to resolve —
// replacing the former user-driven path. Runs after model compile and BEFORE baking (the
// baker needs the already-stamped document); wiring into the pipeline is a later task.
// Gated on the project actually declaring resources (`DeclaresResources`), since a
// project with no MuralResource-derived annotation applications has nothing to stamp.
// Mutates the shared `CompiledPackage.document` held in the artifact bag in place, so the
// downstream EmitPackageLayoutAction serializes the stamped document into model.json. No
// new artifact is produced.
export class StampResourceKeysAction implements IBuildAction<TodlBuildContext>
{
    private static readonly ActionName = "stamp-resource-keys";

    public readonly Name = StampResourceKeysAction.ActionName;
    public readonly Consumes: readonly ArtifactKey<unknown>[] = [NpmArtifacts.CompiledModel];
    public readonly Produces: readonly ArtifactKey<unknown>[] = [];

    public async Execute(ctx: TodlBuildContext): Promise<void>
    {
        const pkg = ctx.Artifacts.Get(NpmArtifacts.CompiledModel);
        if (pkg === undefined) return; // the compile gate did not produce a model

        if (!PresentationResourceEmitter.DeclaresResources(pkg.document, pkg.fullDocument)) return;

        PresentationResourceEmitter.StampResourceKeys(pkg.document, pkg.fullDocument);
    }
}
