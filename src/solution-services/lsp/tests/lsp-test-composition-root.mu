// Instantiates the LspTestCompositionRoot and composes the LspServicesEngine module
// onto it — the markup form of building the LSP composition for a test host.
import LspTestCompositionRoot from "./lsp-test-composition-root.js"
import LspServicesEngine from "../lsp-module.mu.js"

LspTestCompositionRoot {
    .modules: {
        LspServicesEngine
    }
}
