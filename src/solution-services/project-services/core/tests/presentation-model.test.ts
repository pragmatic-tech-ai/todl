import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { compilePackage, type CompiledPackage } from '../../../../publish/publish.js'
import type { JsonNode, TodlDocument } from '../../../../compiler-services/emit/json.js'
import type { SourceFile } from '../../../../compiler-services/diagnostics/span.js'
import { PresentationResourceEmitter } from '../presentation-model.js'

// Compiles a namespace-scoped source fragment (no base packages) into a CompiledPackage,
// exposing both `document` (own-only) and `fullDocument` (the closure, prelude included) —
// the two documents PresentationResourceEmitter's discovery methods need. Reused by every
// test below rather than each test standing up its own compile call.
function compileFixture(src: string): CompiledPackage
{
    const source: SourceFile = { uri: 'fixture.todl', text: src }
    const outcome = compilePackage([], [source], { id: 'fixture', version: '0.1.0' })
    assert.equal(outcome.ok, true, `fixture failed to compile: ${outcome.errors.map((e) => e.message).join('; ')}`)
    return outcome.package!
}

describe('PresentationResourceEmitter — MuralResource ancestry discovery', () =>
{
    // NOTE: the task brief's illustrative fixtures write `namespace demo;` and a
    // standalone `annotate Widget @icon { … }` statement; neither is valid TODL surface
    // syntax (namespace always takes a `{ }` body, and `annotate` always nests inside
    // the target's own declaration body — see src/compiler-services/parse/parser.ts
    // parseNamespace/parseConcept). The fixtures below carry the exact same intent
    // (a custom MuralResource-inheriting annotation vs. the literal prelude `icon`)
    // through the grammar's actual `namespace X { … }` / `annotate <Name> { … }` forms.

    test('DeclaresResources is true for a custom annotation inheriting MuralResource (not literal icon)', () =>
    {
        const src = `namespace demo {
            annotation pin : MuralResource { path : string?; }
            concept Widget { annotate pin { path = "resources/widget.svg"; } }
        }`
        const pkg = compileFixture(src)
        assert.equal(PresentationResourceEmitter.DeclaresResources(pkg.document, pkg.fullDocument), true)
    })

    test('DeclaresResources is false when no MuralResource annotation is applied', () =>
    {
        const pkg = compileFixture('namespace demo { concept Widget {} }')
        assert.equal(PresentationResourceEmitter.DeclaresResources(pkg.document, pkg.fullDocument), false)
    })

    test('DeclaresResources is true for a MuralResource application that sets only key (no path — both optional)', () =>
    {
        const src = `namespace demo {
            annotation pin : MuralResource { path : string?; }
            concept Widget { annotate pin { key = "custom_key"; } }
        }`
        const pkg = compileFixture(src)
        assert.equal(PresentationResourceEmitter.DeclaresResources(pkg.document, pkg.fullDocument), true)
    })

    test('DistinctIcons finds literal @icon paths via the closure', () =>
    {
        const src = 'namespace demo { concept Widget { annotate icon { path = "resources/w.svg"; } } }'
        const pkg = compileFixture(src)
        assert.deepEqual(PresentationResourceEmitter.DistinctIcons(pkg.document, pkg.fullDocument), ['resources/w.svg'])
    })

    test('StampResourceKeys stamps a key attr onto the own icon node when resources are declared', () =>
    {
        const src = 'namespace demo { concept Widget { annotate icon { path = "resources/w.svg"; } } }'
        const pkg = compileFixture(src)
        PresentationResourceEmitter.StampResourceKeys(pkg.document, pkg.fullDocument)
        const stamped = pkg.document.nodes.find((n) => n.attrs['path'] === 'resources/w.svg')
        assert.equal(stamped?.attrs['key'], 'mm_icon_w')
    })

    test('StampResourceKeys is a no-op when no resources are declared', () =>
    {
        const pkg = compileFixture('namespace demo { concept Widget {} }')
        PresentationResourceEmitter.StampResourceKeys(pkg.document, pkg.fullDocument)
        assert.ok(pkg.document.nodes.every((n) => n.attrs['key'] === undefined))
    })
})

// Ported from Plexus's presentation-generator.test.ts when the app-side copy of these
// helpers was deleted (Plexus Task 13) — the emitter is their only home now.
describe('PresentationResourceEmitter — pure presentation helpers', () =>
{
    function node(fields: Record<string, unknown>): JsonNode
    {
        return { attrs: {}, ...fields } as unknown as JsonNode
    }

    function doc(nodes: JsonNode[]): TodlDocument
    {
        return { nodes, edges: [] } as unknown as TodlDocument
    }

    test('IconKey slugs an icon path to a stable identifier', () =>
    {
        assert.equal(PresentationResourceEmitter.IconKey('resources/actor-internal.svg'), 'mm_icon_actor_internal')
        assert.equal(PresentationResourceEmitter.IconKey('resources/sub/role.service.svg'), 'mm_icon_role_service')
        assert.equal(PresentationResourceEmitter.IconKey('a.svg'), 'mm_icon_a')
    })

    test('Humanize title-cases an id split on - and .', () =>
    {
        assert.equal(PresentationResourceEmitter.Humanize('app-component'), 'App Component')
        assert.equal(PresentationResourceEmitter.Humanize('actor'), 'Actor')
        assert.equal(PresentationResourceEmitter.Humanize('connector-type-style'), 'Connector Type Style')
    })

    test('IsRasterIcon detects bitmap extensions, not svg', () =>
    {
        assert.equal(PresentationResourceEmitter.IsRasterIcon('resources/logo.png'), true)
        assert.equal(PresentationResourceEmitter.IsRasterIcon('resources/logo.JPG'), true)
        assert.equal(PresentationResourceEmitter.IsRasterIcon('resources/a.svg'), false)
    })

    test('IncludeLine: colored mode uses `colored` for SVG only; monochrome is always plain', () =>
    {
        assert.equal(PresentationResourceEmitter.IncludeLine('resources/a.svg', 'mm_icon_a', true), '    include colored "resources/a.svg" as mm_icon_a')
        assert.equal(PresentationResourceEmitter.IncludeLine('resources/a.png', 'mm_icon_a', true), '    include "resources/a.png" as mm_icon_a')
        assert.equal(PresentationResourceEmitter.IncludeLine('resources/a.svg', 'mm_icon_a', false), '    include "resources/a.svg" as mm_icon_a')
    })

    test('OntologyEntities keeps concept/relationship/taxonomy/viewpoint/primitive, drops field + instances', () =>
    {
        const m = doc([
            node({ id: 'actor', tier: 'Ontology', metaKind: 'concept' }),
            node({ id: 'depends-on', tier: 'Ontology', metaKind: 'relationship' }),
            node({ id: 'actor-kind', tier: 'Ontology', metaKind: 'taxonomy' }),
            node({ id: 'Model', tier: 'Ontology', metaKind: 'viewpoint' }),
            node({ id: 'text', tier: 'Ontology', metaKind: 'primitive' }),
            node({ id: 'actor.label', tier: 'Ontology', metaKind: 'field' }),
            node({ id: 'actors.internal', tier: 'Instance', type: 'actor' }),
        ])
        assert.deepEqual(PresentationResourceEmitter.OntologyEntities(m).map((n) => n.id), ['actor', 'depends-on', 'actor-kind', 'Model', 'text'])
    })

    test('ClassEntities returns Instance-tier class nodes only', () =>
    {
        const m = doc([
            node({ id: 'actor', tier: 'Ontology', metaKind: 'concept' }),
            node({ id: 'actors.internal', tier: 'Instance', type: 'actor', isClass: true }),
            node({ id: 'web-app', tier: 'Instance', type: 'component', isClass: true }),
            node({ id: 'storefront', tier: 'Instance', type: 'component' }),
        ])
        assert.deepEqual(PresentationResourceEmitter.ClassEntities(m).map((n) => n.id), ['actors.internal', 'web-app'])
    })

    test('ResolveFacets: icon comes from the MuralResource-inherited projection only; label is attr-primary, then annotation, then Humanize', () =>
    {
        // A projected bag carries an inherited annotation's params under every ancestor
        // name, so an applied `icon` shows up under MuralResource too.
        const withAttrs = node({ id: 'actor', attrs: { icon: 'a.svg', label: 'Attr' } })
        assert.deepEqual(PresentationResourceEmitter.ResolveFacets(withAttrs, { 'todl.MuralResource': { path: 'ann.svg' }, 'todl.label': { text: 'Ann' } }), { icon: 'ann.svg', label: 'Attr' })
        assert.deepEqual(PresentationResourceEmitter.ResolveFacets(withAttrs, {}), { label: 'Attr' })
        const bare = node({ id: 'app-component' })
        assert.deepEqual(PresentationResourceEmitter.ResolveFacets(bare, { 'todl.label': { text: 'Ann' } }), { label: 'Ann' })
        assert.deepEqual(PresentationResourceEmitter.ResolveFacets(bare, {}), { label: 'App Component' })
    })

    test('AssignResourceKeys suffixes colliding stems _2, _3 in sorted-path order', () =>
    {
        const pkg = compileFixture(`namespace demo {
            concept A { annotate icon { path = "a/az.svg"; } }
            concept B { annotate icon { path = "b/az.svg"; } }
            concept C { annotate icon { path = "c/az.svg"; } }
            concept D { annotate icon { path = "x/other.svg"; } }
        }`)
        const keys = PresentationResourceEmitter.AssignResourceKeys(pkg.document, pkg.fullDocument)
        assert.equal(keys.get('a/az.svg'), 'mm_icon_az')
        assert.equal(keys.get('b/az.svg'), 'mm_icon_az_2')
        assert.equal(keys.get('c/az.svg'), 'mm_icon_az_3')
        assert.equal(keys.get('x/other.svg'), 'mm_icon_other')
        assert.equal(PresentationResourceEmitter.ResourceKeyFor(pkg.document, pkg.fullDocument, 'b/az.svg'), 'mm_icon_az_2')
    })

    test('BuildIconIndex maps each icon-bearing entity to its resource key under the prefix, omitting icon-less ones', () =>
    {
        const pkg = compileFixture(`namespace demo {
            concept Service { annotate icon { path = "resources/svc.svg"; } }
            concept Plain {}
        }`)
        const index = PresentationResourceEmitter.BuildIconIndex(pkg.document, pkg.fullDocument, 'mm:')
        assert.deepEqual([...index.values()], ['mm_icon_svc'])
        assert.ok([...index.keys()].every((k) => k.startsWith('mm:')))
        const bare = PresentationResourceEmitter.BuildIconIndex(pkg.document, pkg.fullDocument, '')
        assert.ok([...bare.keys()].every((k) => !k.startsWith('mm:')))
        assert.equal(bare.size, 1)
    })
})
