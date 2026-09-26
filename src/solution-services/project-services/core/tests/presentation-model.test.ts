import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { compilePackage, type CompiledPackage } from '../../../../publish/publish.js'
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
