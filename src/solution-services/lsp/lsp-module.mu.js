import { AnalysisEngine } from "./analysis/analysis-engine.js";
import { AnalysisEngineKey } from "./host/i-analysis-engine.js";
import { SolutionLanguageService } from "./host/solution-language-service.js";
import { Module, ServiceProvider } from "@pragmatic-tech-ai/mural/runtime";

export const LspServicesEngine = (() => {
    const _module0 = new Module();
    _module0.AddRegistration(ServiceProvider.tokenFor(SolutionLanguageService), (p) => new SolutionLanguageService(p), 'singleton');
    _module0.AddRegistration(ServiceProvider.tokenFor(AnalysisEngineKey), (p) => new AnalysisEngine(p), 'singleton');
    return _module0;
})();
