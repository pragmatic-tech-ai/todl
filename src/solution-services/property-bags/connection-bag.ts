import { type IPropertyBag } from '@pragmatic-tech-ai/todl-runtime';
import { SettingDefinition, SettingKind } from '@pragmatic-tech-ai/todl-runtime';
import { SettingBagDefinition } from '../solution-manager/engine/setting-bag-definition.js';

// The bag KIND under which registry connections are stored as property bags. One instance per
// connection, addressable at any scope (global/solution/project) — see BagAddress.
export const ConnectionBagKind = 'npm-connection';

// Where a connection's token comes from. Never the token itself: Stored resolves TokenRef against
// the EncryptedSecretStore; Env reads TokenEnvVar from the process environment. Enum (house style)
// with stable string values so persisted bags stay readable.
export enum TokenSource
{
    Stored = 'stored',
    Env = 'env',
}

// Typed façade over the connection's IPropertyBag. Reads/writes named fields only — it holds NO
// raw secret. The token is resolved elsewhere from TokenRef/TokenEnvVar; the bag stores just the
// reference. Works over any IPropertyBag (the persisters yield a RecordPropertyBag).
export class ConnectionBag
{
    public static readonly DisplayNameKey = 'displayName';
    public static readonly RegistryTypeKey = 'registryType';
    public static readonly SettingsKey = 'settings';
    public static readonly TokenSourceKey = 'tokenSource';
    public static readonly TokenRefKey = 'tokenRef';
    public static readonly TokenEnvVarKey = 'tokenEnvVar';
    public static readonly IsDefaultKey = 'isDefault';

    private static readonly Title = 'Connection';
    private static readonly DisplayNameLabel = 'Display name';
    private static readonly RegistryTypeLabel = 'Registry type';
    private static readonly TokenSourceLabel = 'Token source';
    private static readonly TokenRefLabel = 'Token reference';
    private static readonly TokenEnvVarLabel = 'Token environment variable';
    private static readonly IsDefaultLabel = 'Default';
    private static readonly EmptyDefault = '';

    // The full field-key set, in a stable order. Deliberately reference-only: no key names a raw
    // token/secret value.
    public static readonly Fields: readonly string[] = [
        ConnectionBag.DisplayNameKey,
        ConnectionBag.RegistryTypeKey,
        ConnectionBag.SettingsKey,
        ConnectionBag.TokenSourceKey,
        ConnectionBag.TokenRefKey,
        ConnectionBag.TokenEnvVarKey,
        ConnectionBag.IsDefaultKey,
    ];

    constructor(private readonly bag: IPropertyBag)
    {
    }

    public get Bag(): IPropertyBag
    {
        return this.bag;
    }

    public get DisplayName(): string
    {
        return ConnectionBag.asString(this.bag.GetValue(ConnectionBag.DisplayNameKey));
    }

    public set DisplayName(value: string)
    {
        this.bag.SetValue(ConnectionBag.DisplayNameKey, value);
    }

    public get RegistryType(): string
    {
        return ConnectionBag.asString(this.bag.GetValue(ConnectionBag.RegistryTypeKey));
    }

    public set RegistryType(value: string)
    {
        this.bag.SetValue(ConnectionBag.RegistryTypeKey, value);
    }

    public get Settings(): Record<string, unknown>
    {
        const raw = this.bag.GetValue(ConnectionBag.SettingsKey);
        return (raw !== null && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};
    }

    public set Settings(value: Record<string, unknown>)
    {
        this.bag.SetValue(ConnectionBag.SettingsKey, value);
    }

    public get TokenSource(): TokenSource
    {
        return this.bag.GetValue(ConnectionBag.TokenSourceKey) === TokenSource.Env ? TokenSource.Env : TokenSource.Stored;
    }

    public set TokenSource(value: TokenSource)
    {
        this.bag.SetValue(ConnectionBag.TokenSourceKey, value);
    }

    public get TokenRef(): string
    {
        return ConnectionBag.asString(this.bag.GetValue(ConnectionBag.TokenRefKey));
    }

    public set TokenRef(value: string)
    {
        this.bag.SetValue(ConnectionBag.TokenRefKey, value);
    }

    public get TokenEnvVar(): string
    {
        return ConnectionBag.asString(this.bag.GetValue(ConnectionBag.TokenEnvVarKey));
    }

    public set TokenEnvVar(value: string)
    {
        this.bag.SetValue(ConnectionBag.TokenEnvVarKey, value);
    }

    public get IsDefault(): boolean
    {
        return this.bag.GetValue(ConnectionBag.IsDefaultKey) === true;
    }

    public set IsDefault(value: boolean)
    {
        this.bag.SetValue(ConnectionBag.IsDefaultKey, value);
    }

    // The SettingBagDefinition (schema) for the npm-connection kind — drives a PropertyGrid editor
    // and declares the persisted fields. Secret-free by construction: only token REFERENCE fields.
    public static Definition(): SettingBagDefinition
    {
        return new SettingBagDefinition(ConnectionBagKind, ConnectionBag.Title, [
            ConnectionBag.stringField(ConnectionBag.DisplayNameKey, ConnectionBag.DisplayNameLabel),
            ConnectionBag.stringField(ConnectionBag.RegistryTypeKey, ConnectionBag.RegistryTypeLabel),
            ConnectionBag.stringField(ConnectionBag.TokenSourceKey, ConnectionBag.TokenSourceLabel),
            ConnectionBag.stringField(ConnectionBag.TokenRefKey, ConnectionBag.TokenRefLabel),
            ConnectionBag.stringField(ConnectionBag.TokenEnvVarKey, ConnectionBag.TokenEnvVarLabel),
            ConnectionBag.booleanField(ConnectionBag.IsDefaultKey, ConnectionBag.IsDefaultLabel),
        ]);
    }

    private static asString(value: unknown): string
    {
        return typeof value === 'string' ? value : ConnectionBag.EmptyDefault;
    }

    private static stringField(key: string, label: string): SettingDefinition
    {
        const d = new SettingDefinition();
        d.Key = key;
        d.Label = label;
        d.Category = ConnectionBag.Title;
        d.Default = ConnectionBag.EmptyDefault;
        d.Kind = SettingKind.String;
        return d;
    }

    private static booleanField(key: string, label: string): SettingDefinition
    {
        const d = new SettingDefinition();
        d.Key = key;
        d.Label = label;
        d.Category = ConnectionBag.Title;
        d.Default = false;
        d.Kind = SettingKind.Boolean;
        return d;
    }
}
