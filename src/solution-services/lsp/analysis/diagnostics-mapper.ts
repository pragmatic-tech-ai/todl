import { DiagnosticSeverity, type Diagnostic } from "vscode-languageserver-types";
import { Severity, type Diagnostic as TodlDiagnostic } from "../../../compiler-services/diagnostics/diagnostic.js";
import { Positions } from "./positions.js";

export class DiagnosticsMapper
{
    private static readonly SeverityMap: Record<Severity, DiagnosticSeverity> = {
        [Severity.Error]:   DiagnosticSeverity.Error,
        [Severity.Warning]: DiagnosticSeverity.Warning,
    };

    private static readonly Source = "todl";

    // A whole-model (null-span) diagnostic collapses to the document start, matching
    // the current in-renderer behavior.
    private static readonly DocStart = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };

    public static Map(d: TodlDiagnostic): Diagnostic
    {
        return {
            severity: DiagnosticsMapper.SeverityMap[d.severity] ?? DiagnosticSeverity.Error,
            message: d.message,
            code: d.code,
            source: DiagnosticsMapper.Source,
            range: d.span === null ? DiagnosticsMapper.DocStart : Positions.SpanToRange(d.span),
        };
    }

    public static MapMany(ds: readonly TodlDiagnostic[]): Diagnostic[]
    {
        return ds.map(d => DiagnosticsMapper.Map(d));
    }
}
