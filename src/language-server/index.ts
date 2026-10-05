// The out-of-process JSON-RPC LSP server: a transport adapter over the
// `solution-services/lsp` module. The module stays the single symbol authority;
// this is one more consumer of it. (#15)
export { TodlLanguageServer } from "./todl-language-server.js";
export { LspCompositionRoot } from "./lsp-composition-root.js";
