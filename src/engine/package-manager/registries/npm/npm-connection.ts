import { type IPackageRegistryConnection } from '../../engine/registry-connection.js'

// The npm registry type's concrete connections. One npm type serves two backends —
// an HTTP registry (GitHub Packages, Verdaccio, public npm) and a local directory —
// so the connection carries a Kind the registry factory dispatches on (an enum, not
// a string test). Both are plain value objects built by NpmConnectionFactory from a
// ConnectionSpec (+ the resolved secret) and consumed by NpmPackageRegistryFactory.

export const NpmRegistryType = 'npm'

// Which npm backend a connection targets.
export enum NpmConnectionKind
{
    Http = 'http',
    LocalDirectory = 'local-directory',
}

// The settings a live HTTP npm connection needs (everything but the token, which
// arrives separately from ISecretStore). GitHub Packages needs githubApi/org for
// its cross-package listing + delete; a plain registry leaves them undefined.
export interface NpmHttpConnectionConfig
{
    Id: string
    DisplayName: string
    Registry: string
    Scope: string
    Token: string
    GithubApi?: string
    Org?: string
}

// A connection to an HTTP npm-compatible registry.
export class NpmRegistryConnection implements IPackageRegistryConnection
{
    public readonly RegistryType = NpmRegistryType
    public readonly Kind = NpmConnectionKind.Http
    public readonly Id: string
    public readonly DisplayName: string
    public readonly Registry: string
    public readonly Scope: string
    public readonly Token: string
    public readonly GithubApi: string | undefined
    public readonly Org: string | undefined

    constructor(config: NpmHttpConnectionConfig)
    {
        this.Id = config.Id
        this.DisplayName = config.DisplayName
        this.Registry = config.Registry
        this.Scope = config.Scope
        this.Token = config.Token
        this.GithubApi = config.GithubApi
        this.Org = config.Org
    }
}

// A connection to a local directory acting as a registry (the Publish sink and the
// StoragePackageSource read root).
export class LocalDirectoryConnection implements IPackageRegistryConnection
{
    public readonly RegistryType = NpmRegistryType
    public readonly Kind = NpmConnectionKind.LocalDirectory

    constructor(
        public readonly Id: string,
        public readonly DisplayName: string,
        public readonly Directory: string,
    )
    {
    }
}

// Either npm connection concrete — the registry factory narrows on `Kind`.
export type NpmConnection = NpmRegistryConnection | LocalDirectoryConnection
