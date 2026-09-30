import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BagDefinitionRegistry } from '../engine/bag-definition-registry.js';
import { create } from './solutions-test-composition-root.mu.js';

// Creates the composition root from the mural file — which instantiates
// SolutionsTestCompositionRoot and composes the copied SolutionServicesEngine
// module onto it — then releases it. Resolving the (seam-free) settings registry
// proves the module composed; disposing the provider releases every service the
// root owns and is idempotent.
test('the composition root composes the engine module and releases', () => {
    const root = create();

    const settings = root.Provider.getRequired(BagDefinitionRegistry.Key);
    assert.ok(settings instanceof BagDefinitionRegistry);

    root.Provider.dispose();
    root.Provider.dispose(); // idempotent
});
