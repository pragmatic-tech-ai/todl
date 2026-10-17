import { ServiceKey } from "@pragmatic-tech-ai/todl-runtime";

/** Why a connector-backed concept produced no live instances for a reason other than an
 *  empty source. */
export enum ConnectorResolutionIssue
{
    /** The binding's adapter could not be opened (no factory for the kind, or the factory's
     *  Open threw), so the lazy read fell back to the fail-closed empty instance set. */
    Unresolved = "unresolved",
}

/** One adapter-resolution diagnostic raised during a lazy connector read. Carries the
 *  binding's concept/connector/source NAMES and the issue kind only — never connection
 *  settings or secret values (matching the resolution-audit no-secret contract). It lets a
 *  host distinguish "the adapter was unresolved" from "a resolved source returned no rows",
 *  both of which otherwise read as an empty instance set. */
export interface ConnectorResolutionDiagnostic
{
    readonly concept: string;
    readonly connector: string;
    readonly source: string;
    readonly issue: ConnectorResolutionIssue;
}

/** Host-provided seam the engine emits adapter-resolution diagnostics to during a lazy
 *  connector read. Declared engine-side and free of any upper-layer type, so the engine
 *  resolves and emits without depending on the host; absent by default (a no-op). */
export interface IConnectorResolutionDiagnosticSink
{
    Record(diagnostic: ConnectorResolutionDiagnostic): Promise<void>;
}

export const ConnectorResolutionDiagnosticSinkKey =
    new ServiceKey<IConnectorResolutionDiagnosticSink>("ConnectorResolutionDiagnosticSink");
