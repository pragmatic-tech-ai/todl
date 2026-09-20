import { ArchitectureProjectFactory } from "../../project-services/architecture-project/architecture-project-factory.js";
import { DefaultProjectFactoryRegistry } from "../../project-services/default-project-factory-registry.js";
import { LibraryProjectFactory } from "../../project-services/library-project/library-project-factory.js";
import { MetaModelProjectFactory } from "../../project-services/meta-model-project/meta-model-project-factory.js";
import { ProjectFactoryRegistryKey } from "../engine/host-services.js";
import { SolutionManagerService } from "../engine/solution-manager-service.js";
import { SolutionSettingsRegistry } from "../engine/solution-settings-registry.js";
import { Module, ServiceProvider } from "@pragmatic-tech-ai/mural/runtime";

export const SolutionServicesEngine = (() => {
    const _module0 = new Module();
    _module0.AddRegistration(ServiceProvider.tokenFor(SolutionManagerService), (p) => new SolutionManagerService(p), 'singleton');
    _module0.AddRegistration(ServiceProvider.tokenFor(SolutionSettingsRegistry), (p) => new SolutionSettingsRegistry(p), 'singleton');
    _module0.AddRegistration(ServiceProvider.tokenFor(MetaModelProjectFactory), (p) => new MetaModelProjectFactory(p), 'singleton');
    _module0.AddRegistration(ServiceProvider.tokenFor(LibraryProjectFactory), (p) => new LibraryProjectFactory(p), 'singleton');
    _module0.AddRegistration(ServiceProvider.tokenFor(ArchitectureProjectFactory), (p) => new ArchitectureProjectFactory(p), 'singleton');
    _module0.AddRegistration(ServiceProvider.tokenFor(ProjectFactoryRegistryKey), (p) => new DefaultProjectFactoryRegistry(p), 'singleton');
    return _module0;
})();
