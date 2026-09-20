/**
 * `PackageManager` — the backward-compatible entry point for the HTTP npm backend.
 * It is a thin {@link PackageRegistryClient} built over an {@link NpmHttpRegistry}
 * from an {@link NpmRegistryConfig} (the shape the CLI and host consumers already
 * construct: `new PackageManager(config)`). All the rich behaviour now lives on the
 * backend-neutral base; this subclass only adapts the legacy config-in constructor.
 */
import { type NpmRegistryConfig } from "./registry/npm-registry.js";
import { NpmHttpRegistry } from "./registries/npm/npm-http-registry.js";
import { NpmRegistryConnection, type NpmHttpConnectionConfig } from "./registries/npm/npm-connection.js";
import { PackageRegistryClient, type PackageSource, type PackageContents } from "./package-registry-client.js";
import { type LocalPackageStore } from "./local-package-store.js";

export { type PackageSource, type PackageContents };

export class PackageManager extends PackageRegistryClient
{
  constructor(config: NpmRegistryConfig, localStore?: LocalPackageStore)
  {
    super(new NpmHttpRegistry(PackageManager.connectionFrom(config), config.transport), localStore);
  }

  /** Adapt the legacy flat registry config to an npm connection (no persisted
   *  identity — this is an ad-hoc, single-use client). */
  private static connectionFrom(config: NpmRegistryConfig): NpmRegistryConnection
  {
    const connection: NpmHttpConnectionConfig = {
      Id: "",
      DisplayName: "",
      Registry: config.registry,
      Scope: config.scope,
      Token: config.token,
    };
    if (config.githubApi !== undefined) connection.GithubApi = config.githubApi;
    if (config.org !== undefined) connection.Org = config.org;
    return new NpmRegistryConnection(connection);
  }
}
