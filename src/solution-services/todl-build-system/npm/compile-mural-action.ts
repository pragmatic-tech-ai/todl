import type { IBuildAction } from "../../build-system-core/build-action.js";
import type { TodlBuildContext } from "../todl-build-context.js";
import type { ArtifactKey } from "../../build-system-core/artifact-key.js";
import { MuralCompiler } from "../mural/mural-compiler.js";
import { NpmArtifacts } from "./npm-artifacts.js";

// The mural compiler action of the npm-package build (spec §per-project-app-build,
// task 5): compiles a project's `.mu` files (hand-authored or generated) into the
// package so libraries/meta-models that ship `.mu` views deliver compiled JS. The
// compile/collision/write logic itself lives in the shared MuralCompiler (also used
// by html-bundle's own CompileMuralAction) — this action just runs it and records
// the result under NpmArtifacts.CompiledMural. Wiring into the pipeline is a later
// task; this action is not yet consumed by NpmPackageBuildSystem.
export class CompileMuralAction implements IBuildAction<TodlBuildContext>
{
    private static readonly ActionName = "compile-mural";

    public readonly Name = CompileMuralAction.ActionName;
    public readonly Consumes: readonly ArtifactKey<unknown>[] = [];
    public readonly Produces: readonly ArtifactKey<unknown>[] = [NpmArtifacts.CompiledMural];

    public async Execute(ctx: TodlBuildContext): Promise<void>
    {
        const checkpoint = ctx.Diagnostics.Count;
        const written = await new MuralCompiler().Compile(ctx);
        // MuralCompiler reports its own Error diagnostic and returns [] on a collision
        // or a compile failure — in that case no CompiledMural artifact is recorded at
        // all, rather than an empty one that would read as "compiled successfully,
        // nothing to compile" (matches html-bundle's CompileMuralAction).
        if (!ctx.Diagnostics.HasErrorsSince(checkpoint))
        {
            ctx.Artifacts.Set(NpmArtifacts.CompiledMural, written);
        }
    }
}
