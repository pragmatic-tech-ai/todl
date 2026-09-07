import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { vitePluginMural } from "@pragmatic-tech-ai/mural/tooling";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

// The filesystem-backed `include` resolver (SVG → Geometry resource) isn't on
// the tooling barrel, so pull it from Mural's compiled dist. Imported at RUNTIME
// via a computed URL (not a string literal) so esbuild leaves it external when
// it bundles this config — otherwise its transitive visual-engine/runtime graph
// gets hoisted into the app context and a bare `todl-runtime` import fails to
// resolve. As a real runtime import, Node resolves the resolver's deps from
// Mural's own node_modules. Passing it to the plugin makes `include "…svg" as
// Key` work at compile time; the app authors capability icons under
// src/renderer/icons.
type IncludeOpt = NonNullable<Parameters<typeof vitePluginMural>[0]>["include"];
const { makeIncludeResolver } = (await import(
  new URL("../../Mural/dist/tooling/include-resolver.js", import.meta.url).href
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
    build: { target: "esnext" }, // top-level await in the renderer bootstrap
    resolve: {
      alias: [
        { find: /^@shared\//, replacement: `${resolve(repoRoot, "shared")}/` },
        { find: /^@examples\//, replacement: `${resolve(repoRoot, "examples")}/` },
        { find: /^@pragmatic-tech-ai\/todl\/language-server$/, replacement: resolve(repoRoot, "dist/language-server/index.js") },
        { find: /^@pragmatic-tech-ai\/todl\/language-service$/, replacement: resolve(repoRoot, "dist/language-service/index.js") },
        { find: /^@pragmatic-tech-ai\/todl$/, replacement: resolve(repoRoot, "dist/index.js") },
        { find: /^opentype\.js$/, replacement: resolve(rendererSrc, "opentype-shim.mjs") },
      ],
    },
    server: { fs: { allow: [repoRoot, resolve(repoRoot, "..", "Mural")] } },
  },
});
