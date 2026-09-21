// TEMPORARY umbrella — re-exports the split barrels (build-system-core +
// todl-build-system) so existing importers keep working during the migration. Removed in
// the export-surface task once package.json exports + consumers point at the two subpaths.
export * from "../build-system-core/index.js";
export * from "../todl-build-system/index.js";
