import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ProjectFactoryRegistry } from '../project-factory-registry.js'
import { type IProjectFactory } from '../project-factory.js'

// A minimal IProjectFactory stand-in carrying just the type id the registry keys on.
function fake(typeId: string): IProjectFactory {
    return {
        typeId, title: typeId, description: '', formats: [],
        createProject: async () => { throw new Error('unused') },
        openProject: async () => { throw new Error('unused') },
        saveProject: async () => {},
    } as unknown as IProjectFactory
}

test('indexes by typeId; factoryFor resolves, All enumerates, duplicates first-win', () => {
    const arch = fake('architecture')
    const lib = fake('library')
    const dupArch = fake('architecture')
    const reg = new ProjectFactoryRegistry([arch, lib, dupArch])

    assert.equal(reg.factoryFor('architecture'), arch)   // first registration wins
    assert.equal(reg.factoryFor('library'), lib)
    assert.equal(reg.factoryFor('unknown'), undefined)
    assert.deepEqual(reg.All(), [arch, lib])
})
