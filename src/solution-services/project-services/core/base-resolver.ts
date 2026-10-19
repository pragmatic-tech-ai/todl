import { PackageKind, type PackageRef } from '../../../publish/publish.js'
import { type TodlDocument } from '../../../compiler-services/emit/json.js'
import { type ProjectBaseModelBindings } from './base-binding.js'
import { type IPackageSource, type SourcedPackage } from '../../todl-build-system/package-source.js'

// One resolved closure member: the ref it was reached by and the package the source produced.
export interface ResolvedClosureMember
{
    Ref: PackageRef;
    Package: SourcedPackage;
}

// Resolves a project's declared bases into parsed TodlDocuments, walking each package's
// recorded `dependencies` transitively. Reads through the single IPackageSource seam
// (the composite of build outputs, solution cache, and registry), so the resolver stays
// headless and unaware of where a package physically comes from.
export class RecursiveProjectReferencesResolver
{
    // As Resolve, but keeps each member's ref + sourced package (so a caller can emit the
    // per-package model.json). Resolve is the documents-only view of this walk.
    public static async Resolve(
        source: IPackageSource,
        bindings: ProjectBaseModelBindings,
    ): Promise<{ bases: TodlDocument[]; problems: string[] }>
    {
        const { members, problems } = await RecursiveProjectReferencesResolver.ResolveClosure(source, bindings);
        return { bases: members.map(m => m.Package.Document), problems };
    }

    // Own-only packages record the bases they were compiled against; this reassembles
    // the full closure. Deduped by `kind:id@version` (cycle-safe). A binding the source
    // can't produce is collected in `problems` rather than thrown — a consuming project
    // stays usable while its bases are being published.
    public static async ResolveClosure(
        source: IPackageSource,
        bindings: ProjectBaseModelBindings,
    ): Promise<{ members: ResolvedClosureMember[]; problems: string[] }>
    {
        const members: ResolvedClosureMember[] = []
        const problems: string[] = []
        const visited = new Set<string>()

        const queue: PackageRef[] = []
        for (const meta of bindings.metaModels ?? []) queue.push({ kind: PackageKind.MetaModel, ...meta })
        for (const lib of bindings.libraries ?? []) queue.push({ kind: PackageKind.Library, ...lib })
        for (const arch of bindings.architectures ?? []) queue.push({ kind: PackageKind.Architecture, ...arch })

        while (queue.length > 0)
        {
            const ref = queue.shift()!
            const key = `${ref.kind}:${ref.id}@${ref.version}`
            if (visited.has(key)) continue
            visited.add(key)

            const pkg = await source.TryGet(ref)
            if (pkg === undefined)
            {
                const kind = ref.kind === PackageKind.Library ? 'library'
                    : ref.kind === PackageKind.Architecture ? 'architecture'
                    : 'meta-model'
                problems.push(`${kind} "${ref.id}@${ref.version}" is not published`)
                continue
            }
            members.push({ Ref: ref, Package: pkg })
            for (const dep of pkg.Dependencies) queue.push(dep)
        }
        return { members, problems }
    }
}
