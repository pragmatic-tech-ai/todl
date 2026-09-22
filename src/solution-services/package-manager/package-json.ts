/**
 * Generate the npm `package.json` for a publishable TODL package from its authored
 * `project.plexus` (design: todl-package-manager §4). A published TODL package IS
 * an npm package, so npm owns registry/auth/semver/versions/lockfile/cache; this
 * transform is the whole "format" contribution.
 *
 * Only meta-models and libraries are published. An architecture is not a package —
 * it is built by the application build system — so generating one throws.
 */
import { ProjectType, type ProjectManifest } from "./manifest.js";

/** The default npm scope for published TODL packages. Configurable: the scope is
 *  a parameter (Plexus may change it), and resolution never keys off it. */
export const DEFAULT_SCOPE = "@pragmatic-tech-ai";

/** The `todl` block embedded in a generated package.json. The resolve/load adapter
 *  identifies a TODL package by THIS (kind + id), never by the npm scope — so the
 *  scope can change without breaking resolution. */
export interface TodlPackageMeta
{
  kind: ProjectType;
  id: string;
}

/** The generated npm package.json for a published TODL package. */
export interface PackageJson
{
  name: string;
  version: string;
  dependencies: Record<string, string>;
  todl: TodlPackageMeta;
  main: string;
  types: string;
  files: string[];
}

export interface PackageJsonOptions
{
  /** The npm scope, including the leading `@`, without a trailing slash.
   *  Defaults to {@link DEFAULT_SCOPE}. */
  scope?: string;
}

/** The publishable id of a manifest (meta-models and libraries carry `id`). */
function packageId(manifest: ProjectManifest): string
{
  if (manifest.id === undefined || manifest.id.length === 0)
  {
    throw new Error(`project "${manifest.name}" (${manifest.type}) has no id to publish`);
  }
  return manifest.id;
}

/** The publishable version of a manifest (unified across meta-models and libraries). */
function packageVersion(manifest: ProjectManifest): string
{
  const version = manifest.packageVersion;
  if (version === undefined || version.length === 0)
  {
    throw new Error(`project "${manifest.name}" (${manifest.type}) has no publishable version`);
  }
  return version;
}

/**
 * Transform an authored manifest into its generated npm package.json. Every base
 * reference (`metaModels`, `libraries`) becomes an npm `dependency`, each pinned to its
 * exact version and prefixed with the configured scope.
 */
export function toPackageJson(manifest: ProjectManifest, options: PackageJsonOptions = {}): PackageJson
{
  const scope = options.scope ?? DEFAULT_SCOPE;
  const id = packageId(manifest);

  const dependencies: Record<string, string> = {};
  for (const meta of manifest.metaModels ?? [])
  {
    dependencies[`${scope}/${meta.id}`] = meta.version;
  }
  for (const library of manifest.libraries ?? [])
  {
    dependencies[`${scope}/${library.id}`] = library.version;
  }
  for (const architecture of manifest.architectures ?? [])
  {
    dependencies[`${scope}/${architecture.id}`] = architecture.version;
  }

  return {
    name: `${scope}/${id}`,
    version: packageVersion(manifest),
    dependencies,
    todl: { kind: manifest.type, id },
    main: "index.js",
    types: "index.d.ts",
    files: ["model.json", "src", "index.js", "index.d.ts"],
  };
}
