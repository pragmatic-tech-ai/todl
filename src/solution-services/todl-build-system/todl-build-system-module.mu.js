import { TodlBuildSystemRegistry } from "./todl-build-system-registry.js";
import { Module, ServiceProvider } from "@pragmatic-tech-ai/mural/runtime";

export const TodlBuildSystemEngine = (() => {
    const _module0 = new Module();
    _module0.AddRegistration(ServiceProvider.tokenFor(TodlBuildSystemRegistry), (p) => new TodlBuildSystemRegistry(p), 'singleton');
    return _module0;
})();
