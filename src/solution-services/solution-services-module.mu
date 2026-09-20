// SolutionServicesEngine — the headless composition unit for the solution ENGINE.
// A plain `module` (no capabilities / resources) lowers to a `Module`: it records
// the engine's service registrations and replays them into a host's container when
// composed. No UI — a CLI, a test harness, or a shell all compose it the same way
// (a shell adds it alongside its shell modules; mural's ShellCompositionRoot routes
// a plain Module straight through to RegisterServices, never into `Modules`).
//
// It owns the engine services themselves (SolutionManagerService + settings
// registry) AND todl's three built-in project TYPES — the meta-model / library /
// architecture factories — plus the registrar that indexes them
// (DefaultProjectFactoryRegistry, under ProjectFactoryRegistryKey). Project types
// are an engine concern (opening/creating project data), so a host composes them by
// composing the engine, with no app-side factory wiring; an app that ships a
// different type set (e.g. devUI's todl-package) shadows ProjectFactoryRegistryKey
// with its own registry after composing the engine.
//
// The host still supplies the manager's remaining seams — the storage-provider
// registry, the prompt service, the package source — under their keys.
import SolutionManagerService from "./solution-manager/engine/solution-manager-service.js"
import SolutionSettingsRegistry from "./solution-manager/engine/solution-settings-registry.js"
import ProjectFactoryRegistryKey from "./solution-manager/engine/host-services.js"
import MetaModelProjectFactory from "./project-services/meta-model-project/meta-model-project-factory.js"
import LibraryProjectFactory from "./project-services/library-project/library-project-factory.js"
import ArchitectureProjectFactory from "./project-services/architecture-project/architecture-project-factory.js"
import DefaultProjectFactoryRegistry from "./project-services/default-project-factory-registry.js"

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
