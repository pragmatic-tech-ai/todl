// A CONNECTION — the persisted, named binding of a registry type to one backend
// (GitHub Packages, Verdaccio, public npm, a local directory). One registry type
// has many connections. The spec is the round-trippable descriptor (strings only,
// no secret); the live connection is built from it on demand by a connection
// factory.

// The kind of a connection setting field — drives which editor widget a host shows
// and whether the value belongs in the secret store. A real enum (never a string
// union) so registration and editor code share one closed set.
export enum ConnectionFieldKind
{
    Text = 'text',
    Secret = 'secret',
    Url = 'url',
    Choice = 'choice',
}

// One editable field in a connection factory's settings schema: how the host
// renders and validates it. A `Secret` field's value is stored via ISecretStore,
// not in the ConnectionSpec.
export interface ConnectionSettingField
{
    Key: string
    Label: string
    Kind: ConnectionFieldKind
    Required: boolean
    // The options for a ConnectionFieldKind.Choice field; unset for other kinds.
    Choices?: readonly string[]
}

// A named starting point a host offers when creating a connection (e.g. "GitHub
// Packages", "Local Directory"): pre-filled settings the user adopts then edits.
export interface ConnectionPreset
{
    Id: string
    DisplayName: string
    Settings: Record<string, string>
}

// Where a connection's auth token comes from: a value kept in ISecretStore
// (Stored), or read live from an environment variable (Env). A real enum, not a
// string union, so the service branches on a member.
export enum TokenSource
{
    Stored = 'stored',
    Env = 'env',
}

// The persisted, UI-round-trippable descriptor of a connection. Strings only, so
// it crosses IPC and serializes cleanly; a Stored secret lives in ISecretStore
// keyed by this Id (never inline here), an Env secret is read from TokenEnvVar.
export interface ConnectionSpec
{
    Id: string
    DisplayName: string
    RegistryType: string
    Settings: Record<string, string>
    // Undefined ⇒ Stored (the default). Set to Env to source the token from
    // TokenEnvVar instead of the secret store.
    TokenSource?: TokenSource
    // The env-var name holding the token when TokenSource === Env.
    TokenEnvVar?: string
}

// What the host / renderer sees for a connection: its spec fields plus derived
// state — whether a token resolves (HasToken; never the value itself) and whether
// it is the default connection.
export interface ConnectionView
{
    Id: string
    DisplayName: string
    RegistryType: string
    Settings: Record<string, string>
    TokenSource: TokenSource
    TokenEnvVar: string
    HasToken: boolean
    IsDefault: boolean
}

// A live connection to a registry backend, built from a ConnectionSpec by an
// IPackageRegistryConnectionFactory and consumed by an IPackageRegistryFactory to
// build an IPackageRegistry. The base carries only identity + type; a backend's
// concrete connection (e.g. NpmRegistryConnection) adds its own resolved settings.
export interface IPackageRegistryConnection
{
    Id: string
    DisplayName: string
    RegistryType: string
}
