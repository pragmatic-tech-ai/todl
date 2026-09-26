import { type IServiceProvider } from '@pragmatic-tech-ai/todl-runtime';
import { ProjectFactoryRegistry } from '../solution-manager/engine/project-factory-registry.js';
import { MetaModelProjectFactory } from './meta-model-project/meta-model-project-factory.js';
import { LibraryProjectFactory } from './library-project/library-project-factory.js';
import { ArchitectureProjectFactory } from './architecture-project/architecture-project-factory.js';

// The engine's built-in project-factory registrar: it declares the three TODL
// authoring project types todl ships — meta-model, library, architecture — each
// bound to its factory's static Key (a ServiceToken, so registering never forces
// construction). SolutionServicesEngine registers it under ProjectFactoryRegistryKey,
// so any host that composes the engine gets those three types with no app-side
// wiring. A host that wants a different set (e.g. devUI's todl-package) shadows the
// key with its own IProjectFactoryRegistry.
//
// It is a provider-taking subclass of the generic ProjectFactoryRegistry so the
// `.services:` `Impl -> Token` markup can register it as `(p) => new Impl(p)`; the
// base stays definition-based (a test or another host composes any factory set via
// Register).
export class DefaultProjectFactoryRegistry extends ProjectFactoryRegistry
{
    constructor(provider: IServiceProvider)
    {
        super(provider);
        this.Register({ TypeId: MetaModelProjectFactory.ProjectType, Factory: MetaModelProjectFactory.Key });
        this.Register({ TypeId: LibraryProjectFactory.ProjectType, Factory: LibraryProjectFactory.Key });
        this.Register({ TypeId: ArchitectureProjectFactory.ProjectType, Factory: ArchitectureProjectFactory.Key });
    }
}
