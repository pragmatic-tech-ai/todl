// TodlBuildSystemEngine — the headless composition unit for todl's build system. A plain
// `module` (no capabilities / resources) lowers to a `Module`: it records the build-service
// registrations and replays them into a host's container when composed. It contributes the
// populated build-system registry (todl's built-in npm-package system); a host resolves it
// rather than hand-assembling a BuildSystemRegistry.
//
// The host still owns the per-build seams the registry does not: the IBuildStorageProvider
// (the sandbox/output backend) and the package Source, which it passes when it constructs a
// TodlProjectBuildManager. Build SETTINGS are contributed imperatively via
// TodlBuildSettings.Contribute (the ConnectionBag precedent), not through a module block.
import TodlBuildSystemRegistry from "./todl-build-system-registry.js"

module TodlBuildSystemEngine {
    .services: {
        TodlBuildSystemRegistry
    }
}
