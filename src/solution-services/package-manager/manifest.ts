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
  /** Other architectures this architecture composes (nested sub-graphs). */
  architectures?: DependencyRef[];
}

/**
 * The pre-plural-bindings fields an older `project.plexus` may still carry on disk.
 * Projects authored before the plural-bindings schema used a singular `metaModel`
 * and a type-specific version field (`modelVersion` for meta-models, `libVersion`
 * for libraries); ManifestParser maps them onto the current schema at parse time so
 * such projects keep loading — and resolving their bases — without a manual migration.
 */
interface LegacyManifestFields
{
  metaModel?: DependencyRef;
  modelVersion?: string;
  libVersion?: string;
}

/** Parses `project.plexus`, upgrading any legacy shape to the current schema. */
export class ManifestParser
{
  // Parse a `project.plexus` JSON string into a typed manifest. A legacy (pre-plural)
  // manifest is normalized to the current schema; a current one passes through unchanged.
  public static Parse(json: string): ProjectManifest
  {
    return ManifestParser.Normalize(JSON.parse(json) as ProjectManifest & LegacyManifestFields);
  }

  // Map the legacy fields onto the current schema in place, then drop them. Current
  // fields already present win, so a half-migrated manifest keeps its plural bindings:
  // `metaModel` → `metaModels[]`, and `modelVersion` / `libVersion` → `packageVersion`.
  private static Normalize(raw: ProjectManifest & LegacyManifestFields): ProjectManifest
  {
    if ((raw.metaModels === undefined || raw.metaModels.length === 0) && raw.metaModel !== undefined)
    {
      raw.metaModels = [raw.metaModel];
    }
    const legacyVersion = raw.modelVersion ?? raw.libVersion;
    if (raw.packageVersion === undefined && legacyVersion !== undefined)
    {
      raw.packageVersion = legacyVersion;
    }
    delete raw.metaModel;
    delete raw.modelVersion;
    delete raw.libVersion;
    return raw;
  }
}

/**
 * Parse a `project.plexus` JSON string into a typed manifest. The stable functional
 * entry point (published API); delegates to {@link ManifestParser.Parse}, so legacy
 * manifests are upgraded here too.
 */
export function parseManifest(json: string): ProjectManifest
{
  return ManifestParser.Parse(json);
}
