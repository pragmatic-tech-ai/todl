import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { compilePackage, type CompiledPackage } from '../../../../publish/publish.js'
import type { SourceFile } from '../../../../compiler-services/diagnostics/span.js'
import type { JsonEdge, JsonNode, TodlDocument } from '../../../../compiler-services/emit/json.js'
import { DefaultPresentationBaker } from '../default-presentation-baker.js'
import { PresentationBake } from '../presentation-bake.js'

// Compiles a namespace-scoped source fragment into a CompiledPackage. `bases` defaults to
// none. Exposes both `document` (own-only — what PresentationBake ENUMERATES, so a base's
// own icons never get baked into a dependent) and `fullDocument` (the closure — used ONLY
// to resolve annotation ancestry, e.g. the literal `icon` annotation, which extends
// `MuralResource` in the prelude, outside any project's own nodes). Mirrors
// presentation-model.test.ts's compileFixture.
function compileFixture(src: string, id = 'fixture', bases: readonly TodlDocument[] = []): CompiledPackage
{
    const source: SourceFile = { uri: `${id}.todl`, text: src }
    const outcome = compilePackage(bases, [source], { id, version: '0.1.0' })
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
            project, dest, 'out', pkg.document, pkg.fullDocument, { dictName: 'MetaModelPresentation', iconPrefix: 'mm:' },
        )

        assert.deepEqual(result, { ok: true, icons: 1 })

        const compiled = JSON.parse(await dest.ReadText('out/presentation/presentation.compiled.json')) as { body: string; symbols: string[]; className: string }
        assert.equal(compiled.className, 'MetaModelPresentation')
        assert.match(compiled.body, /mm_icon_w/)
        assert.match(compiled.body, /parseSvgIcon/)
        assert.equal(compiled.body.includes('import '), false)

        const entityId = entityIdFor(pkg.document, 'resources/w.svg')
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
            project, dest, 'out', pkg.document, pkg.fullDocument, { dictName: 'LibraryPresentation', iconPrefix: '' },
        )

        assert.deepEqual(result, { ok: true, icons: 1 })

        const compiled = JSON.parse(await dest.ReadText('out/presentation/presentation.compiled.json')) as { body: string; symbols: string[]; className: string }
        assert.equal(compiled.className, 'LibraryPresentation')
        assert.match(compiled.body, /mm_icon_w/)

        const entityId = entityIdFor(pkg.document, 'resources/w.svg')
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
            project, dest, 'out', pkg.document, pkg.fullDocument, { dictName: 'LibraryPresentation', iconPrefix: '' },
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
            project, dest, 'out', pkg.document, pkg.fullDocument, { dictName: 'MetaModelPresentation', iconPrefix: 'mm:' },
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
            project, dest, 'out', pkg.document, pkg.fullDocument, { dictName: 'MetaModelPresentation', iconPrefix: 'mm:' },
        )

        assert.deepEqual(result, { ok: false, missing: ['resources/missing.svg'] })
        assert.equal((dest as FakeStorage).size, 0)
    })
})

describe('PresentationBake.Publish — own-only enumeration against a real base dependency', () =>
{
    // The regression this guards: `document` (own-only) must be the ENUMERATE set and
    // `closure` (fullDocument) must be used ONLY to resolve annotation ancestry. Both
    // fixtures' icon stems are deliberately identical ("own") so that if the
    // implementation ever collapses back to enumerating the closure, the base's icon
    // (alphabetically first: "assets/own.svg" < "resources/own.svg") would steal the
    // unsuffixed key and the dependent's own icon would be pushed to a collision suffix
    // (`mm_icon_own_2`) — AND the base's file (never written into `project`) would trip
    // `missing`. Either symptom fails this test.
    function baseFixture(): CompiledPackage
    {
        return compileFixture(
            'namespace acmebase { concept BaseWidget { annotate icon { path = "assets/own.svg"; } } }',
            'acme-base',
        )
    }

    function dependentFixture(bases: readonly TodlDocument[]): CompiledPackage
    {
        return compileFixture(
            'namespace acmedep { concept OwnWidget { annotate icon { path = "resources/own.svg"; } } }',
            'acme-dep',
            bases,
        )
    }

    test('a base package\'s own icon is never folded into a dependent\'s bake, and the dependent\'s own icon keys identically with or without the base', async () =>
    {
        const base = baseFixture()
        const withBase = dependentFixture([base.fullDocument])
        const alone = dependentFixture([])

        // Both icon files exist in storage — a wrongly-over-enumerating bake would
        // succeed (not trip `missing`) but assign the WRONG (collision-suffixed) key,
        // which the assertions below catch directly.
        const projectWithBase = new FakeStorage()
        await projectWithBase.WriteText('assets/own.svg', '<svg id="base"></svg>')
        await projectWithBase.WriteText('resources/own.svg', '<svg id="own"></svg>')
        const destWithBase = new FakeStorage()

        const resultWithBase = await PresentationBake.Publish(
            projectWithBase, destWithBase, 'out', withBase.document, withBase.fullDocument,
            { dictName: 'MetaModelPresentation', iconPrefix: 'mm:' },
        )
        assert.deepEqual(resultWithBase, { ok: true, icons: 1 })

        const indexWithBase = JSON.parse(await destWithBase.ReadText('out/presentation/icon-index.json')) as Record<string, string>
        const ownEntityId = entityIdFor(withBase.document, 'resources/own.svg')
        // Exactly one entry — the dependent's own entity — never the base's BaseWidget.
        assert.deepEqual(indexWithBase, { [`mm:${ownEntityId}`]: 'mm_icon_own' })

        const compiledWithBase = JSON.parse(await destWithBase.ReadText('out/presentation/presentation.compiled.json')) as { body: string }
        // Only the dependent's own icon content was baked — the base's SVG never appears.
        assert.equal(compiledWithBase.body.includes('id=\\"base\\"'), false)
        assert.match(compiledWithBase.body, /id=\\"own\\"/)

        // Now bake the SAME dependent source compiled with NO base at all.
        const projectAlone = new FakeStorage()
        await projectAlone.WriteText('resources/own.svg', '<svg id="own"></svg>')
        const destAlone = new FakeStorage()

        const resultAlone = await PresentationBake.Publish(
            projectAlone, destAlone, 'out', alone.document, alone.fullDocument,
            { dictName: 'MetaModelPresentation', iconPrefix: 'mm:' },
        )
        assert.deepEqual(resultAlone, { ok: true, icons: 1 })

        const indexAlone = JSON.parse(await destAlone.ReadText('out/presentation/icon-index.json')) as Record<string, string>
        const ownEntityIdAlone = entityIdFor(alone.document, 'resources/own.svg')

        // Deterministic keying: the own icon gets the SAME resource key whether or not
        // an unrelated base sharing its icon's stem is present in the closure.
        assert.equal(indexWithBase[`mm:${ownEntityId}`], indexAlone[`mm:${ownEntityIdAlone}`])
        assert.equal(indexAlone[`mm:${ownEntityIdAlone}`], 'mm_icon_own')
    })
})
