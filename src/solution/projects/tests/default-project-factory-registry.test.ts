import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceProvider } from '@pragmatic-tech-ai/todl-runtime';
import { DefaultProjectFactoryRegistry } from '../default-project-factory-registry.js';
import { MetaModelProjectFactory } from '../meta-model-project-factory.js';
import { LibraryProjectFactory } from '../library-project-factory.js';
import { ArchitectureProjectFactory } from '../architecture-project-factory.js';

// The registrar resolves the three built-in factories from the container by their
// static Keys and indexes them by typeId — the exact set SolutionServicesEngine
// registers, so a host that composes the engine gets meta-model / library /
// architecture with no app-side wiring.
function providerWithFactories(): ServiceProvider {
    const provider = new ServiceProvider();
    provider.register(MetaModelProjectFactory.Key, (p) => new MetaModelProjectFactory(p));
    provider.register(LibraryProjectFactory.Key, (p) => new LibraryProjectFactory(p));
    provider.register(ArchitectureProjectFactory.Key, (p) => new ArchitectureProjectFactory(p));
    return provider;
}

test('factoryFor resolves each built-in project type by its typeId', () => {
    const registry = new DefaultProjectFactoryRegistry(providerWithFactories());
    assert.equal(registry.factoryFor('meta-model')?.typeId, 'meta-model');
    assert.equal(registry.factoryFor('library')?.typeId, 'library');
    assert.equal(registry.factoryFor('architecture')?.typeId, 'architecture');
    assert.equal(registry.factoryFor('todl-package'), undefined);
});

test('All() enumerates exactly the three built-in types', () => {
    const registry = new DefaultProjectFactoryRegistry(providerWithFactories());
    assert.deepEqual(
        registry
            .All()
            .map((f) => f.typeId)
            .sort(),
        ['architecture', 'library', 'meta-model'],
    );
});
