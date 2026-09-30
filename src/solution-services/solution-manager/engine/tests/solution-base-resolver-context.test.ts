import test from 'node:test'
import assert from 'node:assert/strict'
import { ServiceProvider, FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { SolutionBaseResolver } from '../solution-base-resolver.js'
import { SolutionManagerService } from '../solution-manager-service.js'
import { PackageStoreKey } from '../../../todl-build-system/package-store.js'
import type { IPackageSource, SourcedPackage, PackageResolutionContext } from '../../../todl-build-system/package-source.js'
import type { PackageRef } from '../../../../publish/publish.js'
import { ProjectType, type ProjectManifest } from '../../../package-manager/manifest.js'
import { PROJECT_MANIFEST_FILENAME } from '../../../project-services/core/project-factory.js'

// The published source is context-free today; P5b threads a per-consumer resolution
// context (the consumer project's id) so an app-side connection-aware source can pick the
// project's effective connection. This proves ResolveBasesFor passes that context to the
// inner published source for a published-only base.
test('ResolveBasesFor threads the consumer id to the published source context', async () =>
{
    const seen: (PackageResolutionContext | undefined)[] = []
    const published: IPackageSource =
    {
        TryGet(ref: PackageRef, context?: PackageResolutionContext): Promise<SourcedPackage | undefined>
        {
            seen.push(context)
            return Promise.resolve(ref.id === 'core' ? { Document: { nodes: [], edges: [] }, Dependencies: [] } : undefined)
        },
    }

    const provider = new ServiceProvider()
    provider.registerInstance(PackageStoreKey, published as never)
    provider.registerInstance(SolutionManagerService.Key, { ActiveSolution: { Members: [] } } as unknown as SolutionManagerService)
    const resolver = new SolutionBaseResolver(provider)

    const consumer = new FakeStorage()
    const manifest: ProjectManifest = { type: ProjectType.Architecture, name: 'my-arch', version: 1, id: 'my-arch', packageVersion: '1.0.0', metaModels: [{ id: 'core', version: '1.0.0' }] }
    consumer.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(manifest))

    await resolver.ResolveBasesFor(consumer)
    assert.ok(seen.some((c) => c?.consumerId === 'my-arch'), 'inner published source received the consumer id in its context')
})

// An architecture project carries no package id; it is identified by its name. Before this it
// threaded no consumerId, leaving architecture projects resolution-anonymous (connection-aware
// resolution never fired for them). Now the name stands in.
test('ResolveBasesFor threads the architecture name as the consumer id when there is no package id', async () =>
{
    const seen: (PackageResolutionContext | undefined)[] = []
    const published: IPackageSource =
    {
        TryGet(ref: PackageRef, context?: PackageResolutionContext): Promise<SourcedPackage | undefined>
        {
            seen.push(context)
            return Promise.resolve(ref.id === 'core' ? { Document: { nodes: [], edges: [] }, Dependencies: [] } : undefined)
        },
    }

    const provider = new ServiceProvider()
    provider.registerInstance(PackageStoreKey, published as never)
    provider.registerInstance(SolutionManagerService.Key, { ActiveSolution: { Members: [] } } as unknown as SolutionManagerService)
    const resolver = new SolutionBaseResolver(provider)

    const consumer = new FakeStorage()
    const manifest: ProjectManifest = { type: ProjectType.Architecture, name: 'city-model', version: 1, metaModels: [{ id: 'core', version: '1.0.0' }] }
    consumer.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(manifest))

    await resolver.ResolveBasesFor(consumer)
    assert.ok(seen.some((c) => c?.consumerId === 'city-model'), 'inner published source received the architecture name as consumer id')
})

// ConsumerIdOf is the single identity derivation both ends share: a producer's id, an
// architecture's name.
test('ConsumerIdOf yields the package id for a producer and the name for an architecture', async () =>
{
    const provider = new ServiceProvider()
    provider.registerInstance(SolutionManagerService.Key, { ActiveSolution: { Members: [] } } as unknown as SolutionManagerService)
    const resolver = new SolutionBaseResolver(provider)

    const producer = new FakeStorage()
    producer.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: ProjectType.MetaModel, name: 'Core MM', version: 1, id: 'core', packageVersion: '1.0.0' } satisfies ProjectManifest))
    assert.equal(await resolver.ConsumerIdOf(producer), 'core')

    const arch = new FakeStorage()
    arch.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: ProjectType.Architecture, name: 'city-model', version: 1 } satisfies ProjectManifest))
    assert.equal(await resolver.ConsumerIdOf(arch), 'city-model')
})
