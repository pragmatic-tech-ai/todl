import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { PackageKind, type PackageRef } from '../../../../publish/publish.js'
import type { TodlDocument } from '../../../../compiler-services/emit/json.js'
import type { IPackageSource, SourcedPackage } from '../../../build-services/package-source.js'
import { RecursiveProjectReferencesResolver } from '../base-resolver.js'

// A source serving a fixed graph of compiled packages by id, so the resolver's uniform
// walk over metaModels + libraries can be exercised without any storage.
class MapSource implements IPackageSource
{
    constructor(private readonly byId: ReadonlyMap<string, SourcedPackage>) {}

    public TryGet(reference: PackageRef): Promise<SourcedPackage | undefined>
    {
        return Promise.resolve(this.byId.get(reference.id))
    }
}

function pkg(nodeId: string, deps: readonly PackageRef[] = []): SourcedPackage
{
    const doc: TodlDocument = { nodes: [{ id: nodeId, type: 'concept', attrs: {} } as never], edges: [] }
    return { Document: doc, Dependencies: deps }
}

const ref = (id: string, version = '1.0.0'): { id: string; version: string } => ({ id, version })

describe('RecursiveProjectReferencesResolver — multiple base references', () =>
{
    test('resolves every meta-model in a plural metaModels binding', async () =>
    {
        const source = new MapSource(new Map([
            ['core', pkg('CoreConcept')],
            ['extra', pkg('ExtraConcept')],
        ]))

        const { bases, problems } = await RecursiveProjectReferencesResolver.Resolve(source, {
            metaModels: [ref('core'), ref('extra')],
        })

        assert.deepEqual(problems, [])
        assert.equal(bases.length, 2)
        const ids = bases.flatMap((b) => b.nodes.map((n) => n.id))
        assert.ok(ids.includes('CoreConcept') && ids.includes('ExtraConcept'))
    })

    test('resolves meta-models and libraries together, transitively', async () =>
    {
        const source = new MapSource(new Map([
            ['core', pkg('CoreConcept')],
            ['ext', pkg('ExtConcept', [{ kind: PackageKind.MetaModel, ...ref('core') }])], // ext depends on core
            ['lib', pkg('LibTerm', [{ kind: PackageKind.MetaModel, ...ref('core') }])],
        ]))

        const { bases, problems } = await RecursiveProjectReferencesResolver.Resolve(source, {
            metaModels: [ref('ext')],
            libraries: [ref('lib')],
        })

        assert.deepEqual(problems, [])
        // ext + lib + core (deduped once despite both depending on it) = 3 bases.
        assert.equal(bases.length, 3)
    })

    test('reports each unresolved reference without failing the others', async () =>
    {
        const source = new MapSource(new Map([['core', pkg('CoreConcept')]]))

        const { bases, problems } = await RecursiveProjectReferencesResolver.Resolve(source, {
            metaModels: [ref('core'), ref('missing')],
        })

        assert.equal(bases.length, 1)
        assert.equal(problems.length, 1)
        assert.match(problems[0]!, /missing/)
    })
})
