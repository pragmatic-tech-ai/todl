import { SolutionManagerService } from "../engine/solution-manager-service.js";
import { BagDefinitionRegistry } from "../engine/bag-definition-registry.js";
import { Module, ServiceProvider } from "@pragmatic-tech-ai/mural/runtime";

export const SolutionServicesEngine = (() => {
    const _module0 = new Module();
    _module0.AddRegistration(ServiceProvider.tokenFor(SolutionManagerService), (p) => new SolutionManagerService(p), 'singleton');
    _module0.AddRegistration(ServiceProvider.tokenFor(BagDefinitionRegistry), (p) => new BagDefinitionRegistry(p), 'singleton');
    return _module0;
})();
