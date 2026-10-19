// The live tenant a "remote" app build targets: where the app reads its data at
// runtime instead of carrying an inlined snapshot. Non-secret by construction —
// credentials never travel through build options.
export interface RemoteBuildTarget
{
    ServerUrl: string;
    Tenant: string;
    AppName: string;
}

// Invocation-time parameters threaded into every BuildActionContext (spec §10
// decision: fixed typed shape, grown field-by-field). Carries an optional
// override of the resolved output root and the optional remote-app target.
export interface BuildOptions
{
    OutputRootOverride?: string;
    Remote?: RemoteBuildTarget;
}
