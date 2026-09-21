// Invocation-time parameters threaded into every BuildActionContext (spec §10
// decision: fixed typed shape, grown field-by-field). v1 carries only an optional
// override of the resolved output root.
export interface BuildOptions
{
    OutputRootOverride?: string;
}
