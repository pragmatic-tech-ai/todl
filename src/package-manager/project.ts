/**
 * Read a TODL project from disk (design: todl-package-manager §5, SP4): its
 * `project.plexus` manifest and all `.todl` sources (excluding `node_modules` and
 * `dist`). The unit both the pack and publish commands operate on.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { SourceFile } from "../diagnostics/span.js";
import { parseManifest, type ProjectManifest } from "./manifest.js";

export interface Project {
  directory: string;
  manifest: ProjectManifest;
  sources: SourceFile[];
}

/** Recursively collect the `.todl` sources under `root`, skipping build/dep dirs.
 *  Each `uri` is the POSIX path relative to the project root. */
function readTodlSources(root: string): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        walk(join(dir, entry.name));
      } else if (entry.name.endsWith(".todl")) {
        const full = join(dir, entry.name);
        out.push({ uri: full.slice(root.length + 1).split("\\").join("/"), text: readFileSync(full, "utf8") });
      }
    }
  };
  walk(root);
  return out;
}

/** Read a project directory into a manifest + its sources. */
export function readProject(directory: string): Project {
  const manifest = parseManifest(readFileSync(join(directory, "project.plexus"), "utf8"));
  return { directory, manifest, sources: readTodlSources(directory) };
}
