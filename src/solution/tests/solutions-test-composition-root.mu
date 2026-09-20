// A mural file that instantiates the SolutionsTestCompositionRoot and composes the
// copied SolutionServicesEngine module onto it — the markup form of building the
// engine composition for a test host.
import SolutionsTestCompositionRoot from "./solutions-test-composition-root.js"
import SolutionServicesEngine from "./solution-services-engine.mu.js"

SolutionsTestCompositionRoot {
    .modules: {
        SolutionServicesEngine
    }
}
