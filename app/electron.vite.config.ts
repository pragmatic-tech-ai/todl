import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { vitePluginMural } from "@pragmatic-tech-ai/mural/tooling";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const rendererSrc = resolve(here, "src/renderer");

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    plugins: [vitePluginMural()],
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
