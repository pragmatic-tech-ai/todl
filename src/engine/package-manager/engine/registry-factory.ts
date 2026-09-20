import { type IPackageRegistry } from './package-registry.js'
import {
    type IPackageRegistryConnection,
    type ConnectionSpec,
    type ConnectionSettingField,
    type ConnectionPreset,
} from './registry-connection.js'

// The two factory kinds, keyed by ONE registry type.
//
// An IPackageRegistryFactory ESTABLISHES a registry type: registering it is what
// "defines" the type (RegistryType), and it builds live IPackageRegistry clients
// of that type. An IPackageRegistryConnectionFactory DECLARES the type it serves
// and may only register once that type exists — the catalog enforces the order.

// Establishes a registry type and builds live clients from a connection. One per
// registry type; the first to claim a RegistryType wins.
export interface IPackageRegistryFactory
{
    RegistryType: string
    Title: string
    Create(connection: IPackageRegistryConnection): IPackageRegistry
}

// Builds connections for the ONE registry type it declares. Exposes the settings
// schema and presets a host's connection editor renders, and turns a saved spec
// (plus the resolved secret) into a live connection. The registry type it declares
// must already be established by an IPackageRegistryFactory.
export interface IPackageRegistryConnectionFactory
{
    RegistryType: string
    Title: string
    SettingsSchema: readonly ConnectionSettingField[]
    Presets: readonly ConnectionPreset[]
    // The secret is passed in by the caller (resolved from ISecretStore) rather than
    // read from the spec, so it never persists in the ConnectionSpec.
    Create(spec: ConnectionSpec, secret?: string): IPackageRegistryConnection
}
