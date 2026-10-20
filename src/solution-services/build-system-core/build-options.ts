// The live tenant a "remote" app build targets: where the app reads its data at
// runtime instead of carrying an inlined snapshot. Non-secret by construction —
// credentials never travel through build options.
// Which graph a remote app binds to at runtime. Application opens the app's own
// per-app graph; Environment skips OpenApplication so reads resolve to the environment graph.
export enum RemoteBindMode
{
    Application = 'application',
    Environment = 'environment',
}

export interface RemoteBuildTarget
{
    AppName: string;
    // Absent behaves as RemoteBindMode.Application.
    Bind?: RemoteBindMode;
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
