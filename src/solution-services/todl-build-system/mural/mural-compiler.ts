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
// Where a compiled module lands in the sandbox. CompiledBasename (default) flattens
// to `compiled/<basename>.mu.js` (npm-package build); Sibling keeps the source's
// project-relative path, so `src/a/foo.mu` -> `src/a/foo.mu.js` next to its source.
export enum MuralOutputLayout
{
    CompiledBasename,
    Sibling,
}

export class MuralCompiler
{
    private static readonly ActionName = "compile-mural";
    private static readonly SourceExtension = ".mu";
    private static readonly CompiledExtension = ".mu.js";
    private static readonly CompiledSuffixAfterMu = ".js";
    private static readonly CompiledDirectory = "compiled";
    private static readonly CompileFailedMessagePrefix = "failed to compile ";
    private static readonly CollisionMessagePrefix = "two .mu sources compile to the same output ";
    // Top-level directories that hold build OUTPUT, not source: a producer project's
    // `dist/` is its published artifact tree (a compiled copy of its own `.mu`/`.todl`
    // sources). Walking it as source makes every generated `.mu` collide with its root
    // original on the shared `compiled/<basename>.mu.js` output, which blocks publish.
    // Excluded at the project root only — mirrors TodlProjectSourceFiles' `.todl`
    // collection; a nested `dist/` folder is not special.
    private static readonly BuildOutputDirs: ReadonlySet<string> = new Set(["dist"]);
    private static readonly PathSeparator = "/";
    // Presentation `.mu` is NOT an app view — it is the project's icon/visual presentation,
    // baked separately into presentation.compiled.json by BakeResourcesAction (which wires an
    // include resolver over the project's SVGs). It uses `include colored "resources/*.svg"`,
    // which this text-only generic compile cannot resolve, and its compiled output is never
    // loaded (the html-bundle app only ever loads the src/*.mu.js siblings of its entry graph). Two forms are excluded:
    // the generated inspection preview `presentation.generated.mu` (any location) and the
    // author templates under a top-level `presentation/` folder.
    private static readonly GeneratedPresentationFile = "presentation.generated.mu";
    private static readonly PresentationDir = "presentation";

    public constructor(private readonly layout: MuralOutputLayout = MuralOutputLayout.CompiledBasename)
    {
    }

    public async Compile(ctx: TodlBuildContext): Promise<readonly string[]>
    {
        const sources = (await StorageTree.Files(ctx.Project))
            .filter((path) => path.endsWith(MuralCompiler.SourceExtension))
            .filter((path) => !MuralCompiler.IsUnderBuildOutput(path))
            .filter((path) => !MuralCompiler.IsPresentationSource(path));

        const written: string[] = [];
        // Two `.mu` sources in different folders share a basename (e.g. `a/app.mu` and
        // `b/app.mu`) → the same `compiled/app.mu.js` output (default layout). Detected up front (before
        // any compile) so one silently clobbers the other's JS instead of both landing:
        // report an Error naming both sources and stop, rather than emit a bundle built
        // from whichever happened to be written last.
        const sourceByOutput = new Map<string, string>();
        for (const path of sources)
        {
            const outputPath = this.OutputPathFor(path);
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

            const outputPath = this.OutputPathFor(path);
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

    // True when the source lives under a top-level build-output directory (`dist/`).
    // A path with no separator is a project-root file and is never excluded.
    private static IsUnderBuildOutput(path: string): boolean
    {
        const slashIndex = path.indexOf(MuralCompiler.PathSeparator);
        if (slashIndex === -1) return false;
        return MuralCompiler.BuildOutputDirs.has(path.slice(0, slashIndex));
    }

    // True when the source is presentation markup (baked separately, see the field comments):
    // the generated inspection file by basename, or anything under a top-level `presentation/`.
    private static IsPresentationSource(path: string): boolean
    {
        const slashIndex = path.lastIndexOf(MuralCompiler.PathSeparator);
        const baseName = slashIndex === -1 ? path : path.slice(slashIndex + 1);
        if (baseName === MuralCompiler.GeneratedPresentationFile) return true;
        return path.indexOf(MuralCompiler.PathSeparator) !== -1
            && path.slice(0, path.indexOf(MuralCompiler.PathSeparator)) === MuralCompiler.PresentationDir;
    }

    private OutputPathFor(sourcePath: string): string
    {
        if (this.layout === MuralOutputLayout.Sibling)
        {
            return `${sourcePath}${MuralCompiler.CompiledSuffixAfterMu}`;
        }
        const slashIndex = sourcePath.lastIndexOf(MuralCompiler.PathSeparator);
        const fileName = slashIndex === -1 ? sourcePath : sourcePath.slice(slashIndex + 1);
        const baseName = fileName.slice(0, -MuralCompiler.SourceExtension.length);
        return `${MuralCompiler.CompiledDirectory}/${baseName}${MuralCompiler.CompiledExtension}`;
    }
}
