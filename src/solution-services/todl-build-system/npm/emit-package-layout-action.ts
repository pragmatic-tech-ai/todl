import type { IBuildAction } from "../../build-system-core/build-action.js";
import type { TodlBuildContext } from "../todl-build-context.js";
import type { ArtifactKey } from "../../build-system-core/artifact-key.js";
import { Severity } from "../../build-system-core/diagnostic-sink.js";
import { StorageTree } from "../../build-system-core/storage-tree.js";
import type { TodlDocument } from "../../../compiler-services/emit/json.js";
import { toPackageJson, type TodlPackageMeta } from "../../package-manager/package-json.js";
import { PROJECT_MANIFEST_FILENAME } from "../../project-services/core/project-factory.js";
import { NpmArtifacts } from "./npm-artifacts.js";

// Stages the npm package layout into the Sandbox: package.json, model.json (own-only +
// deps), the raw .todl under src/, the browser-safe handle module (index.js/.d.ts), and
// every non-.todl project file packed verbatim under resources/.
export class EmitPackageLayoutAction implements IBuildAction<TodlBuildContext>
{
    private static readonly ActionName = "emit-package-layout";
    private static readonly TodlExtension = ".todl";
    private static readonly ResourcePrefix = "resources/";
    private static readonly ExcludedDirs = ["dist/", "node_modules/", ".git/"];
    private static readonly NoModelMessage = "no compiled model to emit";

    public readonly Name = EmitPackageLayoutAction.ActionName;
    public readonly Consumes: readonly ArtifactKey<unknown>[] = [NpmArtifacts.CompiledModel];
    public readonly Produces: readonly ArtifactKey<unknown>[] = [];

    public async Execute(ctx: TodlBuildContext): Promise<void>
    {
        const pkg = ctx.Artifacts.Get(NpmArtifacts.CompiledModel);
        if (pkg === undefined)
        {
            ctx.Diagnostics.Report({ severity: Severity.Error, message: EmitPackageLayoutAction.NoModelMessage, source: EmitPackageLayoutAction.ActionName });
            return;
        }

        const packageJson = toPackageJson(ctx.Manifest);
        await ctx.Sandbox.WriteText("package.json", `${JSON.stringify(packageJson, null, 2)}\n`);
        await ctx.Sandbox.WriteText("model.json", `${JSON.stringify(pkg.document, null, 2)}\n`);
        for (const source of pkg.sources) await ctx.Sandbox.WriteText(`src/${source.uri}`, source.text);
        await ctx.Sandbox.WriteText("index.js", EmitPackageLayoutAction.HandleModule(pkg.document, packageJson.todl));
        await ctx.Sandbox.WriteText("index.d.ts", EmitPackageLayoutAction.HandleTypes());
        await EmitPackageLayoutAction.PackResources(ctx);
    }

    // Every non-.todl project file (except the manifest + build/vcs dirs) packed
    // verbatim under resources/, so the package carries what it needs to work.
    private static async PackResources(ctx: TodlBuildContext): Promise<void>
    {
        for (const path of await StorageTree.Files(ctx.Project))
        {
            if (EmitPackageLayoutAction.IsExcludedResource(path)) continue;
            await ctx.Sandbox.WriteBytes(`${EmitPackageLayoutAction.ResourcePrefix}${path}`, await ctx.Project.ReadBytes(path));
        }
    }

    private static IsExcludedResource(path: string): boolean
    {
        if (path.endsWith(EmitPackageLayoutAction.TodlExtension)) return true;
        if (path === PROJECT_MANIFEST_FILENAME) return true;
        return EmitPackageLayoutAction.ExcludedDirs.some((dir) => path.startsWith(dir));
    }

    // The embedded handle module: the compiled model.json inlined as a browser-safe ES
    // module (importing the package yields its document with no I/O).
    private static HandleModule(document: TodlDocument, meta: TodlPackageMeta): string
    {
        return [
            "// Generated TODL package handle. The compiled model.json is inlined so that",
            "// importing this package yields its document with no I/O (browser-safe).",
            `export const document = ${JSON.stringify(document)};`,
            `export const meta = ${JSON.stringify(meta)};`,
            "export default document;",
            "",
        ].join("\n");
    }

    private static HandleTypes(): string
    {
        return [
            "export declare const document: unknown;",
            "export declare const meta: { kind: string; id: string };",
            "declare const _default: unknown;",
            "export default _default;",
            "",
        ].join("\n");
    }
}
