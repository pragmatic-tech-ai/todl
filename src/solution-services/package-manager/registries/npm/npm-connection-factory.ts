import { ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/todl-runtime'
import {
    ConnectionFieldKind,
    type ConnectionSpec,
    type ConnectionSettingField,
    type ConnectionPreset,
    type IPackageRegistryConnection,
} from '../../engine/registry-connection.js'
import { type IPackageRegistryConnectionFactory } from '../../engine/registry-factory.js'
import {
    NpmRegistryConnection,
    LocalDirectoryConnection,
    NpmRegistryType,
    type NpmHttpConnectionConfig,
} from './npm-connection.js'

// Builds npm connections from a saved spec (+ the resolved secret). One npm type
// serves two backends: a spec with a non-empty `directory` setting yields a
// LocalDirectoryConnection, otherwise an HTTP NpmRegistryConnection. Exposes the
// editor schema (the token is a Secret field the host routes to ISecretStore, never
// persisted in Settings) and a preset per common backend.
export class NpmConnectionFactory implements IPackageRegistryConnectionFactory
{
    public static readonly Key = new ServiceKey<NpmConnectionFactory>('NpmConnectionFactory')

    public readonly RegistryType = NpmRegistryType
    public readonly Title = 'npm registry'

    // Setting keys — one home for each, shared between the schema, the presets, and
    // the Create dispatch.
    private static readonly RegistryKey = 'registry'
    private static readonly ScopeKey = 'scope'
    private static readonly TokenKey = 'token'
    private static readonly GithubApiKey = 'githubApi'
    private static readonly OrgKey = 'org'
    private static readonly DirectoryKey = 'directory'

    public readonly SettingsSchema: readonly ConnectionSettingField[] = [
        { Key: NpmConnectionFactory.RegistryKey, Label: 'Registry URL', Kind: ConnectionFieldKind.Url, Required: true },
        { Key: NpmConnectionFactory.ScopeKey, Label: 'Scope', Kind: ConnectionFieldKind.Text, Required: false },
        { Key: NpmConnectionFactory.TokenKey, Label: 'Token', Kind: ConnectionFieldKind.Secret, Required: false },
        { Key: NpmConnectionFactory.GithubApiKey, Label: 'GitHub API', Kind: ConnectionFieldKind.Url, Required: false },
        { Key: NpmConnectionFactory.OrgKey, Label: 'Organization', Kind: ConnectionFieldKind.Text, Required: false },
        { Key: NpmConnectionFactory.DirectoryKey, Label: 'Local Directory', Kind: ConnectionFieldKind.Text, Required: false },
    ]

    public readonly Presets: readonly ConnectionPreset[] = [
        {
            Id: 'github',
            DisplayName: 'GitHub Packages',
            Settings: {
                [NpmConnectionFactory.RegistryKey]: 'https://npm.pkg.github.com',
                [NpmConnectionFactory.GithubApiKey]: 'https://api.github.com',
            },
        },
        {
            Id: 'verdaccio',
            DisplayName: 'Verdaccio',
            Settings: { [NpmConnectionFactory.RegistryKey]: 'http://localhost:4873' },
        },
        {
            Id: 'public-npm',
            DisplayName: 'public npm',
            Settings: { [NpmConnectionFactory.RegistryKey]: 'https://registry.npmjs.org' },
        },
        {
            Id: 'local',
            DisplayName: 'Local Directory',
            Settings: { [NpmConnectionFactory.DirectoryKey]: './packages' },
        },
    ]

    constructor(_provider: IServiceProvider)
    {
    }

    public Create(spec: ConnectionSpec, secret?: string): IPackageRegistryConnection
    {
        const directory = spec.Settings[NpmConnectionFactory.DirectoryKey]
        if (directory !== undefined && directory !== '')
        {
            return new LocalDirectoryConnection(spec.Id, spec.DisplayName, directory)
        }

        const config: NpmHttpConnectionConfig = {
            Id: spec.Id,
            DisplayName: spec.DisplayName,
            Registry: spec.Settings[NpmConnectionFactory.RegistryKey] ?? '',
            Scope: spec.Settings[NpmConnectionFactory.ScopeKey] ?? '',
            Token: secret ?? '',
        }
        const githubApi = spec.Settings[NpmConnectionFactory.GithubApiKey]
        const org = spec.Settings[NpmConnectionFactory.OrgKey]
        if (githubApi !== undefined && githubApi !== '') config.GithubApi = githubApi
        if (org !== undefined && org !== '') config.Org = org
        return new NpmRegistryConnection(config)
    }
}
