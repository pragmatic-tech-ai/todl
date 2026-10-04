// LspServicesEngine — the headless composition unit for the TODL language service.
// A plain `module` lowers to a `Module` that replays its registrations into a host's
// container. SolutionLanguageService registers under its own static Key; the
// in-process AnalysisEngine registers under the IAnalysisEngine interface key, so a
// host may shadow AnalysisEngineKey with an out-of-process engine.
import SolutionLanguageService from "./host/solution-language-service.js"
import AnalysisEngine from "./analysis/analysis-engine.js"
import AnalysisEngineKey from "./host/i-analysis-engine.js"

module LspServicesEngine {
    .services: {
        SolutionLanguageService
        AnalysisEngine -> AnalysisEngineKey
    }
}
