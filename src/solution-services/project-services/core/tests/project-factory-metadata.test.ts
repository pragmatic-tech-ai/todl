import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ServiceProvider } from '@pragmatic-tech-ai/todl-runtime'
import { MetaModelProjectFactory } from '../../meta-model-project/meta-model-project-factory.js'
import { LibraryProjectFactory } from '../../library-project/library-project-factory.js'
import { ArchitectureProjectFactory } from '../../architecture-project/architecture-project-factory.js'

// Every project factory is self-describing: it carries the stable type id and the
// New-Project gallery display metadata (title + description) that used to live in a
// mural `ProjectFactoryDefinition`. The values below are the ones the retired
// `.projectFactories:` blocks declared.
test('each factory reports its self-describing type metadata', () => {
    const p = new ServiceProvider()

    const mm = new MetaModelProjectFactory(p)
    assert.equal(mm.typeId, 'meta-model')
    assert.equal(mm.title, 'Meta-model Project')
    assert.equal(mm.description, 'Author and validate TODL meta-model definitions.')

    const lib = new LibraryProjectFactory(p)
    assert.equal(lib.typeId, 'library')
    assert.equal(lib.title, 'Library Project')
    assert.equal(lib.description, 'Author a technology library (taxonomy) against a meta-model.')

    const arch = new ArchitectureProjectFactory(p)
    assert.equal(arch.typeId, 'architecture')
    assert.equal(arch.title, 'Architecture Project')
    assert.equal(arch.description, '')
})
