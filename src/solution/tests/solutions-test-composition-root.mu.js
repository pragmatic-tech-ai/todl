import { SolutionServicesEngine } from "./solution-services-engine.mu.js";
import { SolutionsTestCompositionRoot } from "./solutions-test-composition-root.js";

export function create() {
    const _solutionsTestCompositionRoot0 = new SolutionsTestCompositionRoot();
    _solutionsTestCompositionRoot0.AddModule(SolutionServicesEngine);
    return _solutionsTestCompositionRoot0;
}
