// SolutionServicesEngine — the headless composition unit for the solution ENGINE.
// A plain `module` (no capabilities / resources) lowers to a `Module`: it records
// the engine's service registrations and replays them into a host's container when
// composed. No UI — a CLI, a test harness, or a shell all compose it the same way
// (a shell adds it alongside its shell modules; mural's ShellCompositionRoot routes
// a plain Module straight through to RegisterServices, never into `Modules`).
//
// It owns the engine services themselves: SolutionManagerService + the settings
// registry. Project TYPES are NOT registered here: todl's three built-in factories
// (meta-model / library / architecture) and the one registry that indexes them
// (under ProjectFactoryRegistryKey) come from TodlProjectSystemModule — the
// project-system module a host lists at the head of its `.modules:` block. An app
// that ships a different type set (e.g. devUI's todl-package) registers its own
// IProjectFactoryRegistry under ProjectFactoryRegistryKey instead.
//
// The host still supplies the manager's remaining seams — the project-factory
// registry (TodlProjectSystemModule or its own), the storage-provider registry, the
// prompt service, the package source — under their keys.
import SolutionManagerService from "./solution-manager/engine/solution-manager-service.js"
import SolutionSettingsRegistry from "./solution-manager/engine/solution-settings-registry.js"

module SolutionServicesEngine {
    .services: {
        SolutionManagerService
        SolutionSettingsRegistry
    }
}
