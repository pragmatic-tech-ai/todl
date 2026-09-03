/**
 * The authored project manifest — `project.plexus` (design: todl-package-manager
 * §4). This is the source of truth for a TODL package's identity and dependencies;
 * the npm `package.json` is generated from it at pack time (see package-json.ts).
 */

/** The kind of TODL project a manifest describes. */
export enum ProjectType {
  MetaModel = "meta-model",
  Library = "library",
  Architecture = "architecture",
}

/** A pinned dependency on another TODL package — id + exact version (no ranges). */
export interface DependencyRef {
  id: string;
  version: string;
}

/**
 * A parsed `project.plexus`. Which fields are present depends on `type`:
 * a meta-model carries `id` + `modelVersion`; a library adds `libVersion` +
 * `metaModel`; an architecture carries `metaModel` + `libraries` (and is not
 * published — it is built by the application build system).
 */
export interface ProjectManifest {
  type: ProjectType;
  name: string;
  /** The `project.plexus` format version — NOT the package version. */
  version: number;
  /** Package id. Meta-models and libraries carry it; an architecture uses `name`. */
  id?: string;
  /** Published version of a meta-model. */
  modelVersion?: string;
  /** Published version of a library. */
  libVersion?: string;
  /** The meta-model a library (or architecture) is built against. */
  metaModel?: DependencyRef;
  /** The libraries an architecture depends on. */
  libraries?: DependencyRef[];
}

/** Parse a `project.plexus` JSON string into a typed manifest. */
export function parseManifest(json: string): ProjectManifest {
  return JSON.parse(json) as ProjectManifest;
}
