import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { compilePackage, type CompiledPackage } from '../../../../publish/publish.js'
import type { SourceFile } from '../../../../compiler-services/diagnostics/span.js'
import type { JsonEdge, JsonNode } from '../../../../compiler-services/emit/json.js'
import { DefaultPresentationBaker } from '../default-presentation-baker.js'
import { PresentationBake } from '../presentation-bake.js'

// Compiles a namespace-scoped source fragment (no base packages) into a CompiledPackage,
// exposing `fullDocument` — the closure-complete document PresentationBake needs so a
// prelude-inherited annotation (the literal `icon`, which extends `MuralResource` in the
// prelude) resolves correctly. Mirrors presentation-model.test.ts's compileFixture.
function compileFixture(src: string): CompiledPackage
{
    const source: SourceFile = { uri: 'fixture.todl', text: src }
    const outcome = compilePackage([], [source], { id: 'fixture', version: '0.1.0' })
    assert.equal(outcome.ok, true, `fixture failed to compile: ${outcome.errors.map((e) => e.message).join('; ')}`)
    return outcome.package!
}

// The id of the entity carrying the `@icon` application whose path is `path` — found by
// following the `Annotated` edge from the icon-application node found via its stamped
// `path` attr, rather than hardcoding the compiler's namespace-qualified id scheme.
function entityIdFor(doc: { nodes: readonly JsonNode[]; edges: readonly JsonEdge[] }, path: string): string
{
    const iconNode = doc.nodes.find((n) => n.attrs['path'] === path)
    assert.ok(iconNode, `expected an icon application node with path ${path}`)
    const edge = doc.edges.find((e) => e.kind === 'Annotated' && e.to === iconNode!.id)
    assert.ok(edge, `expected an Annotated edge into ${iconNode!.id}`)
    return edge!.from
}

describe('PresentationBake.Publish / DefaultPresentationBaker — meta-model and library dict variants', () =>
{
    test('meta-model variant bakes presentation.compiled.json + icon-index.json with the mm: prefix', async () =>
    {
        const pkg = compileFixture(
            'namespace demo { concept Widget { annotate icon { path = "resources/w.svg"; } } }',
        )
        const project = new FakeStorage()
        await project.WriteText('resources/w.svg', '<svg><rect fill="red" width="1" height="1"/></svg>')
        const dest = new FakeStorage()

        const result = await new DefaultPresentationBaker().Bake(
            project, dest, 'out', pkg.fullDocument, { dictName: 'MetaModelPresentation', iconPrefix: 'mm:' },
        )

        assert.deepEqual(result, { ok: true, icons: 1 })

        const compiled = JSON.parse(await dest.ReadText('out/presentation/presentation.compiled.json')) as { body: string; symbols: string[]; className: string }
        assert.equal(compiled.className, 'MetaModelPresentation')
        assert.match(compiled.body, /mm_icon_w/)
        assert.match(compiled.body, /parseSvgIcon/)
        assert.equal(compiled.body.includes('import '), false)

        const entityId = entityIdFor(pkg.fullDocument, 'resources/w.svg')
        const index = JSON.parse(await dest.ReadText('out/presentation/icon-index.json')) as Record<string, string>
        assert.deepEqual(index, { [`mm:${entityId}`]: 'mm_icon_w' })
    })

    test('library variant bakes the same artifacts under the empty (no-prefix) keyspace', async () =>
    {
        const pkg = compileFixture(
            'namespace demo { concept Widget { annotate icon { path = "resources/w.svg"; } } }',
        )
        const project = new FakeStorage()
        await project.WriteText('resources/w.svg', '<svg><rect fill="blue" width="1" height="1"/></svg>')
        const dest = new FakeStorage()

        const result = await new DefaultPresentationBaker().Bake(
            project, dest, 'out', pkg.fullDocument, { dictName: 'LibraryPresentation', iconPrefix: '' },
        )

        assert.deepEqual(result, { ok: true, icons: 1 })

        const compiled = JSON.parse(await dest.ReadText('out/presentation/presentation.compiled.json')) as { body: string; symbols: string[]; className: string }
        assert.equal(compiled.className, 'LibraryPresentation')
        assert.match(compiled.body, /mm_icon_w/)

        const entityId = entityIdFor(pkg.fullDocument, 'resources/w.svg')
        const index = JSON.parse(await dest.ReadText('out/presentation/icon-index.json')) as Record<string, string>
        assert.deepEqual(index, { [entityId]: 'mm_icon_w' })
    })

    test('bakes a raster icon to a BitmapImage entry', async () =>
    {
        const pkg = compileFixture(
            'namespace demo { concept Widget { annotate icon { path = "resources/w.png"; } } }',
        )
        const project = new FakeStorage()
        await project.WriteBytes('resources/w.png', new Uint8Array([1, 2, 3, 4]))
        const dest = new FakeStorage()

        const result = await PresentationBake.Publish(
            project, dest, 'out', pkg.fullDocument, { dictName: 'LibraryPresentation', iconPrefix: '' },
        )

        assert.deepEqual(result, { ok: true, icons: 1 })
        const compiled = JSON.parse(await dest.ReadText('out/presentation/presentation.compiled.json')) as { body: string }
        assert.match(compiled.body, /BitmapImage/)
        assert.match(compiled.body, /data:image\/png;base64,/)
    })

    test('a referenced icon whose file is unreadable returns { ok: false, missing } and writes nothing', async () =>
    {
        const pkg = compileFixture(
            'namespace demo { concept Widget { annotate icon { path = "resources/missing.svg"; } } }',
        )
        const project = new FakeStorage() // the icon file is never written
        const dest = new FakeStorage()

        const result = await new DefaultPresentationBaker().Bake(
            project, dest, 'out', pkg.fullDocument, { dictName: 'MetaModelPresentation', iconPrefix: 'mm:' },
        )

        assert.deepEqual(result, { ok: false, missing: ['resources/missing.svg'] })
        assert.equal(await dest.Exists('out/presentation/presentation.compiled.json'), false)
        assert.equal(await dest.Exists('out/presentation/icon-index.json'), false)
        assert.equal((dest as FakeStorage).size, 0)
    })

    test('a mix of one readable and one missing icon still blocks the whole publish', async () =>
    {
        const pkg = compileFixture(`namespace demo {
            concept Widget { annotate icon { path = "resources/w.svg"; } }
            concept Gadget { annotate icon { path = "resources/missing.svg"; } }
        }`)
        const project = new FakeStorage()
        await project.WriteText('resources/w.svg', '<svg></svg>')
        const dest = new FakeStorage()

        const result = await PresentationBake.Publish(
            project, dest, 'out', pkg.fullDocument, { dictName: 'MetaModelPresentation', iconPrefix: 'mm:' },
        )

        assert.deepEqual(result, { ok: false, missing: ['resources/missing.svg'] })
        assert.equal((dest as FakeStorage).size, 0)
    })
})
