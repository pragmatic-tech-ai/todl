import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SolutionLanguageService } from '../host/solution-language-service.js';
import { AnalysisEngineKey } from '../host/i-analysis-engine.js';
import { AnalysisEngine } from '../analysis/analysis-engine.js';
import { create } from './lsp-test-composition-root.mu.js';

// The module composes the host service under its static Key and the in-process
// engine under the IAnalysisEngine interface key.
test('LspServicesEngine composes the language service and analysis engine', () => {
    const root = create();

    assert.ok(root.Provider.getRequired(SolutionLanguageService.Key) instanceof SolutionLanguageService);
    assert.ok(root.Provider.getRequired(AnalysisEngineKey) instanceof AnalysisEngine);

    root.Provider.dispose();
});
