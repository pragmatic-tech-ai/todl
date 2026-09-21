import { Severity } from "../../compiler-services/diagnostics/diagnostic.js";

// build-services keeps its own lightweight diagnostic rather than the compiler's
// (whose `code`/`span`/`node` are compiler-specific). It reuses the shared Severity
// enum. A compile action maps compiler diagnostics into these; build-level messages
// (an action threw, a dependency cycle) are reported directly.
export { Severity };

export interface BuildDiagnostic
{
    severity: Severity;
    message: string;
    /** The action or project that produced it, when known. */
    source?: string;
}

// The failure channel (spec §3): actions Report problems here and return; the
// manager checkpoints Count before an action and asks HasErrorsSince afterwards to
// decide stop-or-continue. The same sink accumulates the run's full diagnostic list
// for the status report.
export class DiagnosticSink
{
    private readonly items: BuildDiagnostic[] = [];

    public Report(diagnostic: BuildDiagnostic): void
    {
        this.items.push(diagnostic);
    }

    public get Count(): number
    {
        return this.items.length;
    }

    public HasErrorsSince(checkpoint: number): boolean
    {
        for (let i = checkpoint; i < this.items.length; i++)
        {
            if (this.items[i]!.severity === Severity.Error) return true;
        }
        return false;
    }

    public All(): readonly BuildDiagnostic[]
    {
        return this.items;
    }
}
