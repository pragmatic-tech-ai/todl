import test from 'node:test'
import assert from 'node:assert/strict'
import { ServiceProvider } from '@pragmatic-tech-ai/todl-runtime'
import { ProjectFactoryRegistry } from '../project-factory-registry.js'

class FakeFactory
{
    public readonly typeId: string
    public readonly title = 't'
    public readonly description = 'd'
    public readonly formats = []
    constructor(typeId: string) { this.typeId = typeId }
    createProject(): never { throw new Error('unused') }
    openProject(): never { throw new Error('unused') }
    saveProject(): never { throw new Error('unused') }
}

test('resolves a registered factory lazily by type id', () =>
{
    const provider = new ServiceProvider()
    let built = 0
    const token = { description: 'meta' } as never
    provider.register(token, () => { built++; return new FakeFactory('meta') as never })
    const registry = new ProjectFactoryRegistry(provider)
    registry.Register({ TypeId: 'meta', Factory: token })
    assert.equal(built, 0)                       // not constructed at Register
    assert.equal(registry.factoryFor('meta')!.typeId, 'meta')
    assert.equal(built, 1)                       // constructed on first lookup
})

test('duplicate type id is ignored (first wins), no throw', () =>
{
    const provider = new ServiceProvider()
    const a = { description: 'a' } as never
    const b = { description: 'b' } as never
    provider.register(a, () => new FakeFactory('meta') as never)
    provider.register(b, () => new FakeFactory('meta') as never)
    const registry = new ProjectFactoryRegistry(provider)
    registry.Register({ TypeId: 'meta', Factory: a })
    registry.Register({ TypeId: 'meta', Factory: b })
    assert.equal(registry.All().length, 1)
})
