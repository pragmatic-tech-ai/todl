import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { vitePluginMural } from "@pragmatic-tech-ai/mural/tooling";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

// The filesystem-backed `include` resolver (SVG → Geometry resource) isn't on
// the tooling barrel, so pull it from the published mural package's compiled
// dist (node_modules). Imported at RUNTIME via a computed URL (not a string
// literal) so esbuild leaves it external when it bundles this config —
// otherwise its transitive visual-engine/runtime graph gets hoisted into the
// app context and a bare `todl-runtime` import fails to resolve. As a real
// runtime import, Node resolves the resolver's deps from mural's own
// node_modules. Passing it to the plugin makes `include "…svg" as Key` work at
// compile time; the app authors capability icons under src/renderer/icons.
type IncludeOpt = NonNullable<Parameters<typeof vitePluginMural>[0]>["include"];
const { makeIncludeResolver } = (await import(
  new URL(
    "./node_modules/@pragmatic-tech-ai/mural/dist/tooling/include-resolver.js",
    import.meta.url,
  ).href
)) as { makeIncludeResolver: (baseDir: string) => IncludeOpt };

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const rendererSrc = resolve(here, "src/renderer");

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: [
        { find: /^@pragmatic-tech-ai\/todl\/package-manager$/, replacement: resolve(repoRoot, "dist/package-manager/index.js") },
      ],
    },
  },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    // `include` paths in .mu resolve relative to rendererSrc (where app-icons.mu
    // lives), so a capability's `Icon = @Home` splices src/renderer/icons/home.svg.
    plugins: [vitePluginMural({ include: makeIncludeResolver(rendererSrc) })],
    // Mural resolves themes/DataTemplates by runtime Class.name — do not rename.
    esbuild: { keepNames: true },
    // Do NOT pre-bundle mural: its esbuild optimizeDeps bundle mis-orders the
    // theme/scheme modules (Material builds before its dark scheme is ready) →
    // ThemeManager.ActivateTheme fails and the shell renders empty in dev. Served
    // as real ESM, live bindings + URL dedup keep a single, correctly-ordered
    // mural. The condition set below still routes it to dist, not src.
    optimizeDeps: {
      exclude: [
        "@pragmatic-tech-ai/mural",
        "@pragmatic-tech-ai/mural/runtime",
        "@pragmatic-tech-ai/mural/basic",
        "@pragmatic-tech-ai/mural/framework",
        "@pragmatic-tech-ai/mural/visual-engine",
        "@pragmatic-tech-ai/mural/tooling",
        "@pragmatic-tech-ai/mural/resources/material",
      ],
      esbuildOptions: { conditions: ["module", "browser"] },
    },
    build: { target: "esnext" }, // top-level await in the renderer bootstrap
    resolve: {
      // Consume published mural via its compiled `dist` (the tested artifact),
      // NOT its `src`. Dropping the "development" condition means the mural
      // exports map resolves to `default` (dist) even in `electron-vite dev`.
      // Its `development` → `./src` path relies on a src/build theme-registration
      // seam that only holds when bundled (build), so under native-ESM dev it
      // left the Material dark scheme unregistered → ThemeManager.ActivateTheme
      // threw and the shell rendered empty. We no longer live-edit mural source
      // here (it's a published dep), so dist-in-dev is both correct and matches
      // the build.
      conditions: ["module", "browser"],
      alias: [
        { find: /^@shared\//, replacement: `${resolve(repoRoot, "shared")}/` },
        { find: /^@examples\//, replacement: `${resolve(repoRoot, "examples")}/` },
        { find: /^@pragmatic-tech-ai\/todl\/language-server$/, replacement: resolve(repoRoot, "dist/language-server/index.js") },
        { find: /^@pragmatic-tech-ai\/todl\/language-service$/, replacement: resolve(repoRoot, "dist/language-service/index.js") },
        { find: /^@pragmatic-tech-ai\/todl$/, replacement: resolve(repoRoot, "dist/index.js") },
        { find: /^opentype\.js$/, replacement: resolve(rendererSrc, "opentype-shim.mjs") },
      ],
    },
    server: { fs: { allow: [repoRoot] } },
  },
});
