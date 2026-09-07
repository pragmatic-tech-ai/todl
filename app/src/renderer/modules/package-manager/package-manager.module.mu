// Package Manager module — the registry package list as a rail capability. Its
// service (PackageManagerService, registered below) connects to the registry
// and exposes the package list; the side panel renders it via
// DataTemplate[PackageManagerService] (package-manager.resources.mu) as a
// ListBox. The service resolves the shared RegistryClient (registered at the
// app root) from the provider.
import PackageManagerService from "./package-manager-service.ts"

module PackageManagerModule [ Name = "Package Manager" ] {
    .services: { PackageManagerService }

    Capability [
        Name       = "Packages",
        Icon       = @Packages,
        ServiceKey = PackageManagerService
    ]
}
