// A COPY of the SolutionServicesEngine composition module (see
// ../solution-services-engine.mu) placed alongside the test composition root, so a
// test host composes the real engine services from markup without reaching into
// the shipping module. Kept in lockstep with the original: the manager + settings
// registry, todl's three built-in project factories, and the registrar that
// indexes them (DefaultProjectFactoryRegistry, under ProjectFactoryRegistryKey).
// The host still supplies the storage-provider registry, prompt service and
// package source under their keys.
import SolutionManagerService from "../engine/solution-manager-service.js"
import SolutionSettingsRegistry from "../engine/solution-settings-registry.js"
import ProjectFactoryRegistryKey from "../engine/host-services.js"
import MetaModelProjectFactory from "../projects/meta-model-project-factory.js"
import LibraryProjectFactory from "../projects/library-project-factory.js"
import ArchitectureProjectFactory from "../projects/architecture-project-factory.js"
import DefaultProjectFactoryRegistry from "../projects/default-project-factory-registry.js"

module SolutionServicesEngine {
    .services: {
        SolutionManagerService
        SolutionSettingsRegistry
        MetaModelProjectFactory
        LibraryProjectFactory
        ArchitectureProjectFactory
        DefaultProjectFactoryRegistry -> ProjectFactoryRegistryKey
    }
}
