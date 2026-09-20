// PackageServicesEngine — the headless composition unit for the PACKAGE engine.
// A plain `module` (no capabilities / resources) lowers to a `Module`: it records
// the engine's service registrations and replays them into a host's container when
// composed. No UI — a CLI, a test harness, or a shell all compose it the same way,
// alongside SolutionServicesEngine (a host's composition root adds both).
//
// It owns the package orchestrator (PackageManagerService) and todl's built-in
// registry TYPE — npm — via the two npm factories plus the catalog that indexes
// them (DefaultPackageRegistryCatalog, under PackageRegistryCatalogKey). A host that
// ships a different registry-type set shadows PackageRegistryCatalogKey with its own
// catalog after composing the engine.
//
// The host still supplies the manager's remaining seams under their keys — the
// connection store (IConnectionStore), the secret store (ISecretStore), the storage
// provider (StorageProviderKey, for local-directory registries) and, optionally, an
// alternate HTTP transport (HttpTransportKey; FetchTransport otherwise).
import PackageManagerService from "./engine/package-manager-service.js"
import PackageRegistryCatalogKey from "./engine/package-registry-catalog.js"
import NpmPackageRegistryFactory from "./registries/npm/npm-package-registry-factory.js"
import NpmConnectionFactory from "./registries/npm/npm-connection-factory.js"
import DefaultPackageRegistryCatalog from "./registries/npm/default-package-registry-catalog.js"

module PackageServicesEngine {
    .services: {
        PackageManagerService
        NpmPackageRegistryFactory
        NpmConnectionFactory
        DefaultPackageRegistryCatalog -> PackageRegistryCatalogKey
    }
}
