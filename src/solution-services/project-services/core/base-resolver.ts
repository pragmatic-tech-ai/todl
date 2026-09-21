import { PackageKind, type PackageRef } from '../../../publish/publish.js'
import { type TodlDocument } from '../../../compiler-services/emit/json.js'
import { type ProjectBaseModelBindings } from './base-binding.js'
import { type IProducerStorageBackends } from './producer-backends.js'

// A published model.json read back: the graph plus any recorded base deps.
interface PackageDocument extends TodlDocument { dependencies?: PackageRef[] }

// Resolves a project's declared bases into parsed TodlDocuments, walking each package's
// recorded `dependencies` transitively. Reads through the IProducerStorageBackends seam (which
// backend a package lives in depends on its kind), so the resolver stays headless.
export class RecursiveProjectReferencesResolver
{
    // Own-only packages record the bases they were compiled against; this reassembles
    // the full closure. Deduped by `kind:id@version` (cycle-safe). A binding whose
    // compiled model.json is missing/unreadable is collected in `problems` rather than
    // thrown — a consuming project stays usable while its bases are being published.
    public static async Resolve(
        backends: IProducerStorageBackends,
        bindings: ProjectBaseModelBindings,
    ): Promise<{ bases: TodlDocument[]; problems: string[] }>
    {
        const bases: TodlDocument[] = []
        const problems: string[] = []
        const visited = new Set<string>()

        const queue: PackageRef[] = []
        if (bindings.metaModel !== undefined) queue.push({ kind: PackageKind.MetaModel, ...bindings.metaModel })
        for (const lib of bindings.libraries ?? []) queue.push({ kind: PackageKind.Library, ...lib })

        while (queue.length > 0)
        {
            const ref = queue.shift()!
            const key = `${ref.kind}:${ref.id}@${ref.version}`
            if (visited.has(key)) continue
            visited.add(key)

            const path = `${ref.id}/${ref.version}/model.json`
            try
            {
                const doc = JSON.parse(await backends.Backend(ref.kind).ReadText(path)) as PackageDocument
                bases.push({ nodes: doc.nodes, edges: doc.edges })
                for (const dep of doc.dependencies ?? []) queue.push(dep)
            }
            catch
            {
                const kind = ref.kind === PackageKind.Library ? 'library' : 'meta-model'
                problems.push(`${kind} "${ref.id}@${ref.version}" is not published`)
            }
        }
        return { bases, problems }
    }
}
