import type { IBuildAction } from "../../build-system-core/build-action.js";
import type { TodlBuildContext } from "../todl-build-context.js";
import type { ArtifactKey } from "../../build-system-core/artifact-key.js";
import { Severity } from "../../build-system-core/diagnostic-sink.js";
import { compilePackage, PackageKind, type PackageRef, type PackageIdentity } from "../../../publish/publish.js";
import { toPackageJson } from "../../package-manager/package-json.js";
import type { ProjectManifest } from "../../package-manager/manifest.js";
import { TodlProjectSourceFiles } from "../../project-services/core/todl-sources.js";
import { NpmArtifacts } from "./npm-artifacts.js";

// Compiles the project's .todl sources against the resolved bases (the pure
// compilePackage), recording the declared deps on the own-only document, and publishes
// the CompiledPackage. Compile errors are reported as diagnostics (stopping the pipeline).
export class CompileModelAction implements IBuildAction<TodlBuildContext>
{
    private static readonly ActionName = "compile-model";

    public readonly Name = CompileModelAction.ActionName;
    public readonly Consumes: readonly ArtifactKey<unknown>[] = [NpmArtifacts.ResolvedBases];
    public readonly Produces: readonly ArtifactKey<unknown>[] = [NpmArtifacts.CompiledModel];

    public async Execute(ctx: TodlBuildContext): Promise<void>
    {
        const bases = ctx.Artifacts.Get(NpmArtifacts.ResolvedBases) ?? [];
        const sources = await TodlProjectSourceFiles.Collect(ctx.Project);
        const packageJson = toPackageJson(ctx.Manifest); // throws on an architecture manifest
        const identity: PackageIdentity = { id: packageJson.todl.id, version: packageJson.version, name: ctx.Manifest.name };

        const outcome = compilePackage([...bases], sources, identity, CompileModelAction.DependencyRefs(ctx.Manifest));
        if (!outcome.ok || outcome.package === undefined)
        {
            for (const error of outcome.errors)
            {
                ctx.Diagnostics.Report({ severity: Severity.Error, message: error.message, source: CompileModelAction.ActionName });
            }
            return;
        }
        ctx.Artifacts.Set(NpmArtifacts.CompiledModel, outcome.package);
    }

    // The pinned dependency refs a manifest declares, as PackageRefs.
    private static DependencyRefs(manifest: ProjectManifest): PackageRef[]
    {
        const refs: PackageRef[] = [];
        for (const meta of manifest.metaModels ?? [])
        {
            refs.push({ kind: PackageKind.MetaModel, id: meta.id, version: meta.version });
        }
        for (const library of manifest.libraries ?? [])
        {
            refs.push({ kind: PackageKind.Library, id: library.id, version: library.version });
        }
        return refs;
    }
}
