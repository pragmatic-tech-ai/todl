// SolutionServicesEngine — the headless composition unit for the solution ENGINE.
// A plain `module` (no capabilities / resources) lowers to a `Module`: it records
// the engine's service registrations and replays them into a host's container when
// composed. No UI — a CLI, a test harness, or a shell all compose it the same way
// (a shell adds it alongside its shell modules; mural's ShellCompositionRoot routes
// a plain Module straight through to RegisterServices, never into `Modules`).
//
// The host still supplies the manager's seams — the storage-provider registry, the
// project-factory registry, the prompt service, the package source — under their
// keys; this module owns only the engine services themselves, which are UI-agnostic.
import SolutionManagerService from "./engine/solution-manager-service.js"
import SolutionSettingsRegistry from "./engine/solution-settings-registry.js"

module SolutionServicesEngine {
    .services: {
        SolutionManagerService
        SolutionSettingsRegistry
    }
}
