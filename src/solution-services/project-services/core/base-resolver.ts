import { PackageKind, type PackageRef } from '../../../publish/publish.js'
import { type TodlDocument } from '../../../compiler-services/emit/json.js'
import { type ProjectBaseModelBindings } from './base-binding.js'
import { type IPackageSource } from '../../todl-build-system/package-source.js'

// Resolves a project's declared bases into parsed TodlDocuments, walking each package's
// recorded `dependencies` transitively. Reads through the single IPackageSource seam
// (the composite of build outputs, solution cache, and registry), so the resolver stays
// headless and unaware of where a package physically comes from.
export class RecursiveProjectReferencesResolver
{
    // Own-only packages record the bases they were compiled against; this reassembles
    // the full closure. Deduped by `kind:id@version` (cycle-safe). A binding the source
    // can't produce is collected in `problems` rather than thrown — a consuming project
    // stays usable while its bases are being published.
    public static async Resolve(
        source: IPackageSource,
        bindings: ProjectBaseModelBindings,
    ): Promise<{ bases: TodlDocument[]; problems: string[] }>
    {
        const bases: TodlDocument[] = []
        const problems: string[] = []
        const visited = new Set<string>()

        const queue: PackageRef[] = []
        for (const meta of bindings.metaModels ?? []) queue.push({ kind: PackageKind.MetaModel, ...meta })
        for (const lib of bindings.libraries ?? []) queue.push({ kind: PackageKind.Library, ...lib })

        while (queue.length > 0)
        {
            const ref = queue.shift()!
            const key = `${ref.kind}:${ref.id}@${ref.version}`
            if (visited.has(key)) continue
            visited.add(key)

            const pkg = await source.TryGet(ref)
            if (pkg === undefined)
            {
                const kind = ref.kind === PackageKind.Library ? 'library' : 'meta-model'
                problems.push(`${kind} "${ref.id}@${ref.version}" is not published`)
                continue
            }
            bases.push(pkg.Document)
            for (const dep of pkg.Dependencies) queue.push(dep)
        }
        return { bases, problems }
    }
}
