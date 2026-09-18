import { SolutionManagerService } from "./engine/solution-manager-service.js";
import { SolutionSettingsRegistry } from "./engine/solution-settings-registry.js";
import { Module, ServiceProvider } from "@pragmatic-tech-ai/mural/runtime";

export const SolutionServicesEngine = (() => {
    const _module0 = new Module();
    _module0.AddRegistration(ServiceProvider.tokenFor(SolutionManagerService), (p) => new SolutionManagerService(p), 'singleton');
    _module0.AddRegistration(ServiceProvider.tokenFor(SolutionSettingsRegistry), (p) => new SolutionSettingsRegistry(p), 'singleton');
    return _module0;
})();
