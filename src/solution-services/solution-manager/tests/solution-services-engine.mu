// A COPY of the SolutionServicesEngine composition module (see
// ../../solution-services-module.mu) placed alongside the test composition root, so
// a test host composes the real engine services from markup without reaching into
// the shipping module. Kept in lockstep with the original: the manager + settings
// registry. The host still supplies the project-factory registry (normally
// TodlProjectSystemModule), storage-provider registry, prompt service and package
// source under their keys.
import SolutionManagerService from "../engine/solution-manager-service.js"
import SolutionSettingsRegistry from "../engine/solution-settings-registry.js"

module SolutionServicesEngine {
    .services: {
        SolutionManagerService
        SolutionSettingsRegistry
    }
}
