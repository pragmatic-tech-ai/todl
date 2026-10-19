// The live tenant a "remote" app build targets: where the app reads its data at
// runtime instead of carrying an inlined snapshot. Non-secret by construction —
// credentials never travel through build options.
export interface RemoteBuildTarget
{
    AppName: string;
    // Dev-only override for a non-same-origin tenant. By default the app connects to the
    // origin that serves it and the server resolves tenant + principal from the session cookie.
    ServerUrl?: string;
    Tenant?: string;
}

// Invocation-time parameters threaded into every BuildActionContext (spec §10
// decision: fixed typed shape, grown field-by-field). Carries an optional
// override of the resolved output root and the optional remote-app target.
export interface BuildOptions
{
    OutputRootOverride?: string;
    Remote?: RemoteBuildTarget;
}
