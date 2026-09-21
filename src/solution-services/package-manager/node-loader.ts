/**
 * Node discovery for the resolve adapter (design: todl-package-manager §5, SP3):
 * scan a `node_modules` directory for installed TODL packages. A TODL package is
 * identified by the `todl` block in its package.json (never by npm scope, which is
 * configurable). The browser host discovers packages differently (bundled handles).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { TodlDocument } from "../../compiler-services/emit/json.js";
import type { TodlPackageMeta } from "./package-json.js";
import type { InstalledPackage } from "./resolve.js";

interface RawPackageJson
{
  name?: string;
  dependencies?: Record<string, string>;
  todl?: TodlPackageMeta;
}

/** Read one package directory as a TODL package, or nothing if it is not one. */
function readPackage(dir: string): InstalledPackage | undefined
{
  const packageJson = join(dir, "package.json");
  const modelJson = join(dir, "model.json");
  if (!existsSync(packageJson) || !existsSync(modelJson)) return undefined;
  const pkg = JSON.parse(readFileSync(packageJson, "utf8")) as RawPackageJson;
  if (pkg.todl === undefined || pkg.name === undefined) return undefined;
  return {
    name: pkg.name,
    meta: pkg.todl,
    dependencies: Object.keys(pkg.dependencies ?? {}),
    document: JSON.parse(readFileSync(modelJson, "utf8")) as TodlDocument,
  };
}

/** Scan `nodeModulesDir` (including `@scope/*` subdirectories) for installed TODL
 *  packages. Non-TODL packages are skipped. */
export function readInstalledPackages(nodeModulesDir: string): InstalledPackage[]
{
  if (!existsSync(nodeModulesDir)) return [];
  const out: InstalledPackage[] = [];
  for (const entry of readdirSync(nodeModulesDir, { withFileTypes: true }))
  {
    if (!entry.isDirectory()) continue;
    const dir = join(nodeModulesDir, entry.name);
    if (entry.name.startsWith("@"))
    {
      for (const scoped of readdirSync(dir, { withFileTypes: true }))
      {
        if (!scoped.isDirectory()) continue;
        const pkg = readPackage(join(dir, scoped.name));
        if (pkg !== undefined) out.push(pkg);
      }
    }
    else
    {
      const pkg = readPackage(dir);
      if (pkg !== undefined) out.push(pkg);
    }
  }
  return out;
}
