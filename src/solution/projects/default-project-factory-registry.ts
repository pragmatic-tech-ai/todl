import { type IServiceProvider } from '@pragmatic-tech-ai/todl-runtime';
import { ProjectFactoryRegistry } from '../engine/project-factory-registry.js';
import { MetaModelProjectFactory } from './meta-model-project-factory.js';
import { LibraryProjectFactory } from './library-project-factory.js';
import { ArchitectureProjectFactory } from './architecture-project-factory.js';

// The engine's built-in project-factory registrar: it indexes the three TODL
// authoring project types todl ships — meta-model, library, architecture — each
// resolved from the container by its static Key. SolutionServicesEngine registers
// it under ProjectFactoryRegistryKey, so any host that composes the engine gets
// those three types with no app-side wiring. A host that wants a different set
// (e.g. devUI's todl-package) shadows the key with its own IProjectFactoryRegistry.
//
// It is a provider-taking subclass of the generic ProjectFactoryRegistry so the
// `.services:` `Impl -> Token` markup can register it as `(p) => new Impl(p)`; the
// base stays list-based (a test or another host composes any factory set).
export class DefaultProjectFactoryRegistry extends ProjectFactoryRegistry
{
    constructor(provider: IServiceProvider)
    {
        super([
            provider.getRequired(MetaModelProjectFactory.Key),
            provider.getRequired(LibraryProjectFactory.Key),
            provider.getRequired(ArchitectureProjectFactory.Key),
        ]);
    }
}
