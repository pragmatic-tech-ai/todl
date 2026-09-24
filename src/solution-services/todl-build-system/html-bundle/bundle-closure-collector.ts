import { PackageKind, type PackageRef, type CompiledPackage } from "../../../publish/publish.js";
import type { IPackageSource } from "../package-source.js";
import type { ProjectBaseModelBindings } from "../../project-services/core/base-binding.js";

// Walks an architecture's base closure deps-first over the build-tier IPackageSource and
// gathers every package's resource bytes (keyed `<id>/<version>/<path>`), plus the
// architecture's own. The mural bundle inlines these resources for the page; the model
// data itself comes from the compiled closure (CompiledModel.fullDocument), not from here.
export class BundleClosureCollector
{
    public static async Collect(
        source: IPackageSource,
        bindings: ProjectBaseModelBindings,
        compiled: CompiledPackage,
    ): Promise<{ problems: string[]; resources: { uri: string; bytes: Uint8Array }[] }>
    {
        const problems: string[] = [];
        const resources: { uri: string; bytes: Uint8Array }[] = [];
        const visited = new Set<string>();

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
            for (const r of pkg.resources ?? []) resources.push({ uri: `${ref.id}/${ref.version}/${r.path}`, bytes: r.bytes });
            for (const dep of pkg.Dependencies) queue.push(dep);
        }

        for (const r of compiled.resources ?? []) resources.push({ uri: `${compiled.id}/${compiled.version}/${r.path}`, bytes: r.bytes });
        return { problems, resources };
    }
}
