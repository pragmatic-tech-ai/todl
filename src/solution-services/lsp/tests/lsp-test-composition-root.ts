import { CompositionRoot } from '@pragmatic-tech-ai/todl-runtime';

// A CompositionRoot for LSP module tests. The LspServicesEngine module is composed
// onto it from markup (see lsp-test-composition-root.mu). SolutionLanguageService
// resolves every host seam (analysis engine, base resolver, package source, manager,
// project events) optionally and falls back to in-process defaults, so no seams need
// registering before resolving. A test that wants to override one registers it on
// `Provider` first; module registrations are lazy factories.
export class LspTestCompositionRoot extends CompositionRoot
{
}
