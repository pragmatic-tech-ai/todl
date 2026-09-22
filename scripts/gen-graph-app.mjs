// Bundle the browser graph-app (GraphApi + thin UI) into one IIFE and capture it as a
// string module, so the html-bundle emit action inlines it with no bundler at emit time.
// Mirrors gen-prelude.mjs. Runs as part of `npm run build`.
import { build } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("../src/graph-api/browser/bundled-host.ts", import.meta.url));
const result = await build({
  entryPoints: [entry],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  write: false,
  logLevel: "silent",
});
const js = result.outputFiles[0].text;
const out =
  "// GENERATED from src/graph-api/browser/app.ts by scripts/gen-graph-app.mjs — do not edit by hand.\n" +
  `export const GraphAppBundle = ${JSON.stringify(js)};\n`;
const target = fileURLToPath(new URL("../src/graph-api/generated/graph-app-bundle.ts", import.meta.url));
mkdirSync(fileURLToPath(new URL("../src/graph-api/generated/", import.meta.url)), { recursive: true });
writeFileSync(target, out);
console.log("wrote src/graph-api/generated/graph-app-bundle.ts");
