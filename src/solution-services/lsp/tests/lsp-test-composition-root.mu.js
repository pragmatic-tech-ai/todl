import { LspServicesEngine } from "../lsp-module.mu.js";
import { LspTestCompositionRoot } from "./lsp-test-composition-root.js";

export function create() {
    const _lspTestCompositionRoot0 = new LspTestCompositionRoot();
    _lspTestCompositionRoot0.AddModule(LspServicesEngine);
    return _lspTestCompositionRoot0;
}
