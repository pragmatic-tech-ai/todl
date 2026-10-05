import { CompositionRoot } from "@pragmatic-tech-ai/todl-runtime";
import { LspServicesEngine } from "../solution-services/lsp/index.js";
import { SolutionLanguageService } from "../solution-services/lsp/index.js";
import type { ILanguageService } from "../solution-services/lsp/host/i-language-service.js";

// Builds the language-service composition the out-of-process server drives: a plain
// CompositionRoot with the one `solution-services/lsp` module applied. The module is
// the single symbol authority — this host adds nothing, so the proxy owns no
// resolver and duplicates no resolution. (#15)
export class LspCompositionRoot extends CompositionRoot
{
    constructor()
    {
        super();
        this.AddModule(LspServicesEngine);
    }

    public LanguageService(): ILanguageService
    {
        return this.Provider.getRequired(SolutionLanguageService.Key);
    }
}
