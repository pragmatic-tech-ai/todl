/**
 * NODE-ONLY entry point for the project-system composition units
 * ("@pragmatic-tech-ai/todl/project-system").
 *
 * The browser-safe core — `ProjectSystemComposer`, `TodlProjectSystemModule`,
 * `BuildSystemRegistryKey` — is exported from the main barrel (`src/index.ts`) and
 * re-exported here for convenience. The node-only additions layer the html-bundle build
 * system (esbuild + node fs) on top of that core: `NodeProjectSystemComposer`,
 * `TodlNodeProjectSystemModule`, and the headless `ProjectSystemContribution`.
 *
 * Do NOT re-export the node-only additions from `src/index.ts`. The html-bundle build
 * system's own app bundle (`BundleAppAction`) targets the browser with `format: "iife"`
 * and no `treeShaking`/`minify` option, so esbuild does NOT auto-enable tree shaking —
 * every `export ... from` edge in a resolved module is bundled whether or not an
 * importer uses it. `tests/browser-safe-composition.test.ts` guards the main barrel.
 */

export { ProjectSystemComposer, type ProjectSystemComposerOptions } from './project-system-composer.js';
export { TodlProjectSystemModule } from './todl-project-system-module.js';
export { BuildSystemRegistryKey } from './build-system-registry-key.js';
export { NodeProjectSystemComposer } from './node-project-system-composer.js';
export { TodlNodeProjectSystemModule } from './todl-node-project-system-module.js';
export { ProjectSystemContribution } from './project-system-contribution.js';
