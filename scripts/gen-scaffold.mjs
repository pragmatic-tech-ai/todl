// Generate src/engine/solution-manager/projects/scaffold.generated.ts from the scaffold .md
// sources. Like the prelude, the agent-support docs must be string constants
// embedded in the module so they survive bundling to a single file (esbuild/CJS),
// where import.meta.url and sibling-file reads break. The .md files under
// scaffold/ stay the hand-editable source of truth; run this to sync.
import { readFileSync, writeFileSync } from "node:fs";

// Each entry: the exported constant name ← its scaffold .md source (relative to
// src/engine/solution-manager/projects/scaffold/). Shared TODL docs first, then per-project-type
// CLAUDE.md roots and guides.
const SOURCES = [
  { name: "TODL_MANUAL_SOURCE", file: "todl-manual.md" },
  { name: "TODL_RULES_SOURCE", file: "todl-rules.md" },
  { name: "ARCHITECTURE_CLAUDE_ROOT", file: "architecture/claude-root.md" },
  { name: "META_MODEL_CLAUDE_ROOT", file: "meta-model/claude-root.md" },
  { name: "META_MODEL_GUIDE", file: "meta-model/meta-model-guide.md" },
  { name: "META_MODEL_NEW_CONCEPT", file: "meta-model/new-concept.md" },
  { name: "LIBRARY_CLAUDE_ROOT", file: "library/claude-root.md" },
];

const read = (file) =>
  readFileSync(new URL(`../src/engine/solution-manager/projects/scaffold/${file}`, import.meta.url), "utf8");

let out = "// GENERATED from src/engine/solution-manager/projects/scaffold/*.md by scripts/gen-scaffold.mjs — do not edit by hand.\n";
for (const { name, file } of SOURCES) {
  out += `export const ${name} = ${JSON.stringify(read(file))};\n`;
}
writeFileSync(new URL("../src/engine/solution-manager/projects/scaffold.generated.ts", import.meta.url), out);
console.log("wrote src/engine/solution-manager/projects/scaffold.generated.ts");
