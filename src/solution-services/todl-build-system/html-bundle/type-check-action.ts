import type { IStorage } from "@pragmatic-tech-ai/todl-runtime";
import type { IBuildAction } from "../../build-system-core/build-action.js";
import type { ArtifactKey } from "../../build-system-core/artifact-key.js";
import type { ITypeChecker } from "../../build-system-core/type-checker.js";
import type { StagedFile } from "../../build-system-core/bundler.js";
import { CanonicalTypeScriptOptions } from "../../build-system-core/compiler-options.js";
import { Severity } from "../../build-system-core/diagnostic-sink.js";
import type { TodlBuildContext } from "../todl-build-context.js";

// The type-check gate of the html-bundle pipeline: gathers the project's TypeScript
// sources (src/ + generated/), runs them through the injected ITypeChecker (tsc,
// behind a node/IPC seam), and reports each returned diagnostic. Error-severity
// diagnostics make the build manager stop (HasErrorsSince). Browser-safe: all tsc +
// filesystem work lives behind ITypeChecker. Produces no artifact — it only verifies.
export class TypeCheckAction implements IBuildAction<TodlBuildContext>
{
    private static readonly ActionName = "type-check";
    private static readonly SourceDirectory = "src";
    private static readonly GeneratedDirectory = "generated";
    private static readonly PathSeparator = "/";
    private static readonly TypeScriptExtensions = [".ts", ".tsx", ".d.ts"];
    private static readonly CheckFailedPrefix = "failed to type-check the project: ";

    public readonly Name = TypeCheckAction.ActionName;
    public readonly Consumes: readonly ArtifactKey<unknown>[] = [];
    public readonly Produces: readonly ArtifactKey<unknown>[] = [];

    constructor(private readonly checker: ITypeChecker)
    {
    }

    public async Execute(ctx: TodlBuildContext): Promise<void>
    {
        try
        {
            const files: StagedFile[] = [];
            await this.GatherIfPresent(ctx.Project, TypeCheckAction.SourceDirectory, files);
            await this.GatherIfPresent(ctx.Project, TypeCheckAction.GeneratedDirectory, files);
            const result = await this.checker.Check({ Files: files, Options: CanonicalTypeScriptOptions });
            for (const diagnostic of result.Diagnostics) ctx.Diagnostics.Report(diagnostic);
        }
        catch (err)
        {
            const detail = err instanceof Error ? err.message : String(err);
            ctx.Diagnostics.Report({ severity: Severity.Error, message: `${TypeCheckAction.CheckFailedPrefix}${detail}`, source: TypeCheckAction.ActionName });
        }
    }

    // A directory that does not exist (e.g. generated/ before generation) contributes no files.
    private async GatherIfPresent(storage: IStorage, dir: string, out: StagedFile[]): Promise<void>
    {
        try
        {
            await this.Gather(storage, dir, out);
        }
        catch
        {
            // absent dir: no files
        }
    }

    private async Gather(storage: IStorage, dir: string, out: StagedFile[]): Promise<void>
    {
        for (const entry of await storage.List(dir))
        {
            const path = `${dir}${TypeCheckAction.PathSeparator}${entry.Name}`;
            if (entry.IsDirectory) await this.Gather(storage, path, out);
            else if (TypeCheckAction.IsTypeScript(entry.Name)) out.push({ Path: path, Text: await storage.ReadText(path) });
        }
    }

    private static IsTypeScript(name: string): boolean
    {
        const lower = name.toLowerCase();
        return TypeCheckAction.TypeScriptExtensions.some((ext) => lower.endsWith(ext));
    }
}
