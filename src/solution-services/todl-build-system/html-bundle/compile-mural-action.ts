import type { IBuildAction } from "../../build-system-core/build-action.js";
import type { TodlBuildContext } from "../todl-build-context.js";
import type { ArtifactKey } from "../../build-system-core/artifact-key.js";
import { MuralCompiler } from "../mural/mural-compiler.js";
import { HtmlArtifacts } from "./html-artifacts.js";

// The mural compiler action of the per-project html-bundle app pipeline (spec
// §per-project-app-build, task 5): discovers every `.mu` file under the project
// (hand-authored or generated, e.g. generated/app.mu from the UiPlaceholderGenerator),
// compiles each to a JS module via mural's `compile()`, and stages the output
// under `compiled/<basename>.mu.js` in the sandbox — never the project, since
// compiled JS is build output, not source the developer edits. A compile failure
// stops the pipeline rather than emitting partial/garbage output. The compile/
// collision/write logic itself lives in the shared MuralCompiler (also used by the
// npm-package build) — this action just runs it and records the result.
export class CompileMuralAction implements IBuildAction<TodlBuildContext>
{
    private static readonly ActionName = "compile-mural";

    public readonly Name = CompileMuralAction.ActionName;
    public readonly Consumes: readonly ArtifactKey<unknown>[] = [];
    public readonly Produces: readonly ArtifactKey<unknown>[] = [HtmlArtifacts.CompiledUi];

    public async Execute(ctx: TodlBuildContext): Promise<void>
    {
        const checkpoint = ctx.Diagnostics.Count;
        const written = await new MuralCompiler().Compile(ctx);
        // MuralCompiler reports its own Error diagnostic and returns [] on a collision
        // or a compile failure — in that case the run is aborted, and (as before the
        // extraction) no CompiledUi artifact is recorded at all, rather than an empty
        // one that would read as "compiled successfully, nothing to compile".
        if (!ctx.Diagnostics.HasErrorsSince(checkpoint))
        {
            ctx.Artifacts.Set(HtmlArtifacts.CompiledUi, written);
        }
    }
}
