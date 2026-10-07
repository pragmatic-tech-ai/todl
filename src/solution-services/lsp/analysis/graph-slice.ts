import type { Diagnostic as TodlDiagnostic } from "../../../compiler-services/diagnostics/diagnostic.js";
import type { Repository } from "../../../compiler-services/model/model.js";

// The per-project read slice of the shared SolutionGraph that lets
// `AnalysisSnapshot.FromGraph` reproduce a project-scoped `Build` snapshot WITHOUT a
// fresh `checkAgainst` recompile. The host assembles one of these from the live graph:
//
// - `Model` is the ONE whole-solution Repository; `FromGraph` wraps it in a
//   `ScopedRepository(VisibleIds, OwnIds)` so resolution matches a scoped compile.
// - `VisibleIds` are the node ids a scoped `Build` model would contain: the project's
//   own nodes PLUS its declared bases' closure PLUS the prelude.
// - `OwnIds` are the project's OWN authored node ids (bases excluded) — the set
//   whose source spans a scoped Build would know, so navigation matches.
// - `DiagnosticsByUri` are the graph's raw (unmapped) per-file diagnostics; a lookup
//   per project file yields that file's bucket, mapped to LSP by `FromGraph`.
// - `WholeModelDiagnostics` are the graph's null-span (model-scope) diagnostics,
//   surfaced on every project file exactly as `Build` surfaces whole-model diagnostics.
export interface GraphSlice
{
    Model: Repository;
    DiagnosticsByUri: ReadonlyMap<string, readonly TodlDiagnostic[]>;
    WholeModelDiagnostics: readonly TodlDiagnostic[];
    VisibleIds: ReadonlySet<string>;
    OwnIds: ReadonlySet<string>;
}
