import { PackageKind, type PackageRef, type CompiledPackage } from "../../../publish/publish.js";
import type { IPackageSource } from "../package-source.js";
import type { ProjectBaseModelBindings } from "../../project-services/core/base-binding.js";
import { PackageManifestBridge } from "../../package-manager/package-manifest-bridge.js";
import type { ResolvedPackage, PackageRef as DomainPackageRef } from "../../../domain/domain.js";

// Walks an architecture's base closure deps-first over the build-tier IPackageSource,
// bridging each package (own document) to a JSON ResolvedPackage, and appends the
// architecture's own compiled package. The result is the inlined package set a
// BundledDomainHost composes in the page; `entry` is the architecture ref.
export class BundleClosureCollector
{
    public static async Collect(
        source: IPackageSource,
        bindings: ProjectBaseModelBindings,
        compiled: CompiledPackage,
    ): Promise<{ packages: ResolvedPackage[]; entry: DomainPackageRef; problems: string[] }>
    {
        const packages: ResolvedPackage[] = [];
        const problems: string[] = [];
        const visited = new Set<string>();

        // The architecture's full closure is the self-contained universe (prelude + all
        // bases + own). Every package's manifest is emitted from it, so Repository
        // construction never chokes on a base own-document's edges into other bases.
        const universe = compiled.fullDocument;

        const queue: PackageRef[] = [];
        for (const meta of bindings.metaModels ?? []) queue.push({ kind: PackageKind.MetaModel, ...meta });
        for (const lib of bindings.libraries ?? []) queue.push({ kind: PackageKind.Library, ...lib });
        for (const arch of bindings.architectures ?? []) queue.push({ kind: PackageKind.Architecture, ...arch });

        while (queue.length > 0)
        {
            const ref = queue.shift()!;
            const key = `${ref.id}@${ref.version}`;
            if (visited.has(key)) continue;
            visited.add(key);

            const pkg = await source.TryGet(ref);
            if (pkg === undefined)
            {
                problems.push(`"${ref.id}@${ref.version}" is not published`);
                continue;
            }
            const deps: DomainPackageRef[] = pkg.Dependencies.map((d) => ({ model: d.id, version: d.version }));
            packages.push(PackageManifestBridge.toResolvedJsonManifest(universe, pkg.Document, ref.id, ref.version, deps));
            for (const dep of pkg.Dependencies) queue.push(dep);
        }

        // The architecture package carries the full closure as its document, so the host's
        // merged query graph is self-contained regardless of the bases' own documents.
        const archDeps: DomainPackageRef[] = (compiled.document.dependencies ?? []).map((d) => ({ model: d.id, version: d.version }));
        packages.push(PackageManifestBridge.toResolvedJsonManifest(universe, universe, compiled.id, compiled.version, archDeps));
        return { packages, entry: { model: compiled.id, version: compiled.version }, problems };
    }
}
