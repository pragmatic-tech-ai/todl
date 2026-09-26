import type { TodlBuildContext } from "../todl-build-context.js";
import { Severity } from "../../build-system-core/diagnostic-sink.js";
import { StorageTree } from "../../build-system-core/storage-tree.js";
import { compile, EmitError, ParseError } from "@pragmatic-tech-ai/mural/compiler";

// Shared by every build system that needs a project's `.mu` files turned into JS
// modules — today html-bundle's CompileMuralAction, soon the npm-package build too
// (spec §per-project-app-build, task 5, extracted for reuse). Discovers every `.mu`
// file under the project (hand-authored or generated), compiles each to a JS module
// via mural's `compile()`, and stages the output under `compiled/<basename>.mu.js` in
// the sandbox — never the project, since compiled JS is build output, not source the
// developer edits. A compile failure (or a basename collision) stops the run rather
// than emitting partial/garbage output.
export class MuralCompiler
{
    private static readonly ActionName = "compile-mural";
    private static readonly SourceExtension = ".mu";
    private static readonly CompiledExtension = ".mu.js";
    private static readonly CompiledDirectory = "compiled";
    private static readonly CompileFailedMessagePrefix = "failed to compile ";
    private static readonly CollisionMessagePrefix = "two .mu sources compile to the same output ";

    public async Compile(ctx: TodlBuildContext): Promise<readonly string[]>
    {
        const sources = (await StorageTree.Files(ctx.Project))
            .filter((path) => path.endsWith(MuralCompiler.SourceExtension));

        const written: string[] = [];
        // Two `.mu` sources in different folders share a basename (e.g. `a/app.mu` and
        // `b/app.mu`) → the same `compiled/app.mu.js` output. Detected up front (before
        // any compile) so one silently clobbers the other's JS instead of both landing:
        // report an Error naming both sources and stop, rather than emit a bundle built
        // from whichever happened to be written last.
        const sourceByOutput = new Map<string, string>();
        for (const path of sources)
        {
            const outputPath = MuralCompiler.OutputPathFor(path);
            const prior = sourceByOutput.get(outputPath);
            if (prior !== undefined)
            {
                ctx.Diagnostics.Report({
                    severity: Severity.Error,
                    message: `${MuralCompiler.CollisionMessagePrefix}${outputPath}: ${prior} and ${path}`,
                    source: MuralCompiler.ActionName,
                });
                return [];
            }
            sourceByOutput.set(outputPath, path);
        }

        for (const path of sources)
        {
            const source = await ctx.Project.ReadText(path);
            const js = await this.CompileOne(ctx, path, source);
            if (js === undefined) return [];

            const outputPath = MuralCompiler.OutputPathFor(path);
            await ctx.Sandbox.WriteText(outputPath, js);
            written.push(outputPath);
        }

        return written.sort();
    }

    // Compiles a single `.mu` source, reporting an Error diagnostic naming the
    // failing file on any compile throw — EmitError/ParseError from mural, or
    // anything else a future compiler version might throw — so a bad file stops
    // the run instead of an uncaught exception escaping Compile.
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
                message: `${MuralCompiler.CompileFailedMessagePrefix}${path}: ${detail}`,
                source: MuralCompiler.ActionName,
            });
            return undefined;
        }
    }

    private static OutputPathFor(sourcePath: string): string
    {
        const slashIndex = sourcePath.lastIndexOf("/");
        const fileName = slashIndex === -1 ? sourcePath : sourcePath.slice(slashIndex + 1);
        const baseName = fileName.slice(0, -MuralCompiler.SourceExtension.length);
        return `${MuralCompiler.CompiledDirectory}/${baseName}${MuralCompiler.CompiledExtension}`;
    }
}
