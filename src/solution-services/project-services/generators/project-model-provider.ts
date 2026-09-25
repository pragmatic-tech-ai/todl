/**
 * The one place that compiles a project to a `CompiledPackage`: resolve the
 * project's declared base bindings, then run the pure `compilePackage` against
 * the project's `.todl` sources. Factored out of `ResolveBasesAction` /
 * `CompileModelAction` (todl-build-system/npm) so the build pipeline and the
 * content generators (which read the model outside of any build action) share
 * one compile path.
 */

import type { IStorage } from "@pragmatic-tech-ai/todl-runtime";
import type { TodlDocument } from "../../../compiler-services/emit/json.js";
import { compilePackage, PackageKind, type PackageIdentity, type PackageRef } from "../../../publish/publish.js";
import type { ProjectManifest } from "../../package-manager/manifest.js";
import { toPackageJson } from "../../package-manager/package-json.js";
import { RecursiveProjectReferencesResolver } from "../core/base-resolver.js";
import type { ProjectBaseModelBindings } from "../core/base-binding.js";
import { TodlProjectSourceFiles } from "../core/todl-sources.js";
import type { IPackageSource } from "../../todl-build-system/package-source.js";
import type { IProjectModelProvider, ProjectModel } from "./project-content-generator.js";

export class ProjectModelProvider implements IProjectModelProvider
{
    private cached?: ProjectModel;

    constructor(
        private readonly project: IStorage,
        private readonly manifest: ProjectManifest,
        private readonly source: IPackageSource) {}

    // Full compile: resolve bases, then compile against them. Memoised on this
    // instance — a second call returns the first call's result without redoing
    // the resolve/compile walk.
    public async Compile(): Promise<ProjectModel>
    {
        if (this.cached !== undefined) return this.cached;

        const { bases, problems } = await this.ResolveBases();
        const model = problems.length > 0 ? { errors: [...problems] } : await this.CompileWithBases(bases);
        this.cached = model;
        return model;
    }

    // Resolves the project's declared base bindings (metaModel + libraries) into base
    // documents through the composite IPackageSource. Mirrors ResolveBasesAction, as the
    // granular half a build action delegates to so the two-artifact pipeline contract
    // (ResolvedBases, CompiledModel) is preserved.
    public async ResolveBases(): Promise<{ bases: readonly TodlDocument[]; problems: readonly string[] }>
    {
        const bindings: ProjectBaseModelBindings = {
            ...(this.manifest.metaModels !== undefined ? { metaModels: this.manifest.metaModels } : {}),
            ...(this.manifest.libraries !== undefined ? { libraries: this.manifest.libraries } : {}),
            ...(this.manifest.architectures !== undefined ? { architectures: this.manifest.architectures } : {}),
        };
        return RecursiveProjectReferencesResolver.Resolve(this.source, bindings);
    }

    // Compiles the project's .todl sources against the given (already-resolved) bases.
    // Mirrors CompileModelAction, as the granular half a build action delegates to.
    public async CompileWithBases(bases: readonly TodlDocument[]): Promise<ProjectModel>
    {
        const sources = await TodlProjectSourceFiles.Collect(this.project);
        const packageJson = toPackageJson(this.manifest); // throws on an architecture manifest
        const identity: PackageIdentity = { id: packageJson.todl.id, version: packageJson.version, name: this.manifest.name };

        const outcome = compilePackage([...bases], sources, identity, ProjectModelProvider.DependencyRefs(this.manifest));
        if (!outcome.ok || outcome.package === undefined)
        {
            return { errors: outcome.errors.map((e) => e.message) };
        }
        return { package: outcome.package, errors: [] };
    }

    // The pinned dependency refs a manifest declares, as PackageRefs (identical to
    // CompileModelAction's).
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
        for (const architecture of manifest.architectures ?? [])
        {
            refs.push({ kind: PackageKind.Architecture, id: architecture.id, version: architecture.version });
        }
        return refs;
    }
}
