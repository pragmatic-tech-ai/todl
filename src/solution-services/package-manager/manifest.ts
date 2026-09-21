/**
 * The authored project manifest — `project.plexus` (design: todl-package-manager
 * §4). This is the source of truth for a TODL package's identity and dependencies;
 * the npm `package.json` is generated from it at pack time (see package-json.ts).
 */

/** The kind of TODL project a manifest describes. */
export enum ProjectType
{
  MetaModel = "meta-model",
  Library = "library",
  Architecture = "architecture",
}

/** A pinned dependency on another TODL package — id + exact version (no ranges). */
export interface DependencyRef
{
  id: string;
  version: string;
}

/**
 * A parsed `project.plexus`. Meta-models and libraries are the same internally: both
 * carry `id` + `packageVersion` and may declare any number of `metaModels` + `libraries`
 * base references. An architecture carries the same bindings but is not published (it is
 * built by the application build system) and uses `name` as its id.
 */
export interface ProjectManifest
{
  type: ProjectType;
  name: string;
  /** The `project.plexus` format version — NOT the package version. */
  version: number;
  /** Package id. Meta-models and libraries carry it; an architecture uses `name`. */
  id?: string;
  /** Published version of the package (meta-model or library). */
  packageVersion?: string;
  /** The meta-models this project is authored against (any number). */
  metaModels?: DependencyRef[];
  /** The libraries this project draws on (any number). */
  libraries?: DependencyRef[];
}

/** Parse a `project.plexus` JSON string into a typed manifest. */
export function parseManifest(json: string): ProjectManifest
{
  return JSON.parse(json) as ProjectManifest;
}
