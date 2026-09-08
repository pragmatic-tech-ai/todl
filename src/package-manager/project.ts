/**
 * Read a TODL project from disk (design: todl-package-manager §5, SP4): its
 * `project.plexus` manifest, all `.todl` sources, and every OTHER file as a
 * verbatim resource (mural `.mu`, images, JSON, docs — whatever the package
 * needs to work), excluding `node_modules`, `dist`, and `.git`. The unit both
 * the pack and publish commands operate on.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { SourceFile } from "../diagnostics/span.js";
import { parseManifest, type ProjectManifest } from "./manifest.js";

/** A non-`.todl` project file, carried into the package verbatim (bytes). */
export interface ResourceFile {
  /** POSIX path relative to the project root. */
  path: string;
  bytes: Uint8Array;
}

export interface Project {
  directory: string;
  manifest: ProjectManifest;
  sources: SourceFile[];
  /** Every non-`.todl` file, packed verbatim (until we distinguish needed from
   *  useless, we pack everything the project carries). */
  resources: ResourceFile[];
}

/** Directory names never walked (build output, dependencies, VCS metadata). */
const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);

/** Recursively collect files under `root`, skipping build/dep/VCS dirs. `.todl`
 *  files go to `sources` (compiled); every other file goes to `resources`
 *  (verbatim bytes). Each relative path is POSIX. */
function readProjectFiles(root: string): { sources: SourceFile[]; resources: ResourceFile[] } {
  const sources: SourceFile[] = [];
  const resources: ResourceFile[] = [];
  const rel = (full: string): string => full.slice(root.length + 1).split("\\").join("/");
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full);
      } else if (entry.name.endsWith(".todl")) {
        sources.push({ uri: rel(full), text: readFileSync(full, "utf8") });
      } else {
        resources.push({ path: rel(full), bytes: readFileSync(full) });
      }
    }
  };
  walk(root);
  return { sources, resources };
}

/** Read a project directory into a manifest + its sources + resources. */
export function readProject(directory: string): Project {
  const manifest = parseManifest(readFileSync(join(directory, "project.plexus"), "utf8"));
  const { sources, resources } = readProjectFiles(directory);
  return { directory, manifest, sources, resources };
}
