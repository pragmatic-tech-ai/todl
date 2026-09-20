import { PackageManagerService } from "./engine/package-manager-service.js";
import { PackageRegistryCatalogKey } from "./engine/package-registry-catalog.js";
import { DefaultPackageRegistryCatalog } from "./registries/npm/default-package-registry-catalog.js";
import { NpmConnectionFactory } from "./registries/npm/npm-connection-factory.js";
import { NpmPackageRegistryFactory } from "./registries/npm/npm-package-registry-factory.js";
import { Module, ServiceProvider } from "@pragmatic-tech-ai/mural/runtime";

export const PackageServicesEngine = (() => {
    const _module0 = new Module();
    _module0.AddRegistration(ServiceProvider.tokenFor(PackageManagerService), (p) => new PackageManagerService(p), 'singleton');
    _module0.AddRegistration(ServiceProvider.tokenFor(NpmPackageRegistryFactory), (p) => new NpmPackageRegistryFactory(p), 'singleton');
    _module0.AddRegistration(ServiceProvider.tokenFor(NpmConnectionFactory), (p) => new NpmConnectionFactory(p), 'singleton');
    _module0.AddRegistration(ServiceProvider.tokenFor(PackageRegistryCatalogKey), (p) => new DefaultPackageRegistryCatalog(p), 'singleton');
    return _module0;
})();
