/**
 * NODE-ONLY entry point for the project-system composition units. `ProjectSystemComposer`
 * (and therefore `TodlProjectSystemModule` / `ProjectSystemContribution`, both thin
 * wrappers around it) reaches `NpmPackageBuildSystem` and `HtmlBundleBuildSystem`, which
 * pull in esbuild + `node-fs-storage` (`node:fs`, `node:path`) — exactly the pieces the
 * browser-safe main barrel (`src/index.ts`) has always kept out (see `./todl-build-system`
 * and `./package-manager`, which are ALSO node-only subpaths for the same reason).
 *
 * Do NOT re-export any of this from `src/index.ts`. The html-bundle build system's own
 * app bundle (`BundleAppAction`) targets the browser with `format: "iife"` and no
 * `treeShaking`/`minify` option, so esbuild does NOT auto-enable tree shaking (per its
 * docs, that only happens for `esm` output or when minifying) — every `export ... from`
 * edge in a resolved module is bundled regardless of whether any importer actually uses
 * it. A prior attempt exported `TodlProjectSystemModule`/`ProjectSystemContribution` from
 * the main barrel and broke the html-bundle app bundle for exactly that reason (see
 * `todl-project-system-module.ts`'s test + task-7-report.md, fix round 1).
 *
 * A host that needs these (the deferred Plexus phase) imports them from
 * "@pragmatic-tech-ai/todl/project-system" instead.
 */

export { TodlProjectSystemModule } from "./todl-project-system-module.js";
export { ProjectSystemContribution } from "./project-system-contribution.js";
export { ProjectSystemComposer, type ProjectSystemComposerOptions } from "./project-system-composer.js";
