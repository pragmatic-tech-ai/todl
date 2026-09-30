import { BagDefinitionRegistry } from "./solution-manager/engine/bag-definition-registry.js";
import { SolutionManagerService } from "./solution-manager/engine/solution-manager-service.js";
import { Module, ServiceProvider } from "@pragmatic-tech-ai/mural/runtime";

export const SolutionServicesEngine = (() => {
    const _module0 = new Module();
    _module0.AddRegistration(ServiceProvider.tokenFor(SolutionManagerService), (p) => new SolutionManagerService(p), 'singleton');
    _module0.AddRegistration(ServiceProvider.tokenFor(BagDefinitionRegistry), (p) => new BagDefinitionRegistry(p), 'singleton');
    return _module0;
})();
