import type { IBuildAction } from "../../build-system-core/build-action.js";
import type { TodlBuildContext } from "../todl-build-context.js";
import type { ArtifactKey } from "../../build-system-core/artifact-key.js";
import { Severity } from "../../build-system-core/diagnostic-sink.js";
import { StorageTree } from "../../build-system-core/storage-tree.js";
import { compile, EmitError, ParseError } from "@pragmatic-tech-ai/mural/compiler";
import { HtmlArtifacts } from "./html-artifacts.js";

// The mural compiler action of the per-project html-bundle app pipeline (spec
// §per-project-app-build, task 5): discovers every `.mu` file under the project
// (hand-authored or generated, e.g. generated/app.mu from GenerateAppUiAction),
// compiles each to a JS module via mural's `compile()`, and stages the output
// under `compiled/<basename>.mu.js` in the sandbox — never the project, since
// compiled JS is build output, not source the developer edits. A compile failure
// stops the pipeline rather than emitting partial/garbage output.
export class CompileMuralAction implements IBuildAction<TodlBuildContext>
{
    private static readonly ActionName = "compile-mural";
    private static readonly SourceExtension = ".mu";
    private static readonly CompiledExtension = ".mu.js";
    private static readonly CompiledDirectory = "compiled";
    private static readonly CompileFailedMessagePrefix = "failed to compile ";

    public readonly Name = CompileMuralAction.ActionName;
    public readonly Consumes: readonly ArtifactKey<unknown>[] = [];
    public readonly Produces: readonly ArtifactKey<unknown>[] = [HtmlArtifacts.CompiledUi];

    public async Execute(ctx: TodlBuildContext): Promise<void>
    {
        const sources = (await StorageTree.Files(ctx.Project))
            .filter((path) => path.endsWith(CompileMuralAction.SourceExtension));

        const written: string[] = [];
        for (const path of sources)
        {
            const source = await ctx.Project.ReadText(path);
            const js = await this.CompileOne(ctx, path, source);
            if (js === undefined) return;

            const outputPath = CompileMuralAction.OutputPathFor(path);
            await ctx.Sandbox.WriteText(outputPath, js);
            written.push(outputPath);
        }

        ctx.Artifacts.Set(HtmlArtifacts.CompiledUi, written);
    }

    // Compiles a single `.mu` source, reporting an Error diagnostic naming the
    // failing file on any compile throw — EmitError/ParseError from mural, or
    // anything else a future compiler version might throw — so a bad file stops
    // the pipeline instead of an uncaught exception escaping Execute.
    private async CompileOne(ctx: TodlBuildContext, path: string, source: string): Promise<string | undefined>
    {
        try
        {
            return compile(source).js;
        }
        catch (err)
        {
            const detail = err instanceof EmitError || err instanceof ParseError || err instanceof Error
                ? err.message
                : String(err);
            ctx.Diagnostics.Report({
                severity: Severity.Error,
                message: `${CompileMuralAction.CompileFailedMessagePrefix}${path}: ${detail}`,
                source: CompileMuralAction.ActionName,
            });
            return undefined;
        }
    }

    private static OutputPathFor(sourcePath: string): string
    {
        const slashIndex = sourcePath.lastIndexOf("/");
        const fileName = slashIndex === -1 ? sourcePath : sourcePath.slice(slashIndex + 1);
        const baseName = fileName.slice(0, -CompileMuralAction.SourceExtension.length);
        return `${CompileMuralAction.CompiledDirectory}/${baseName}${CompileMuralAction.CompiledExtension}`;
    }
}
