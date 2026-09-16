import { ServiceBase, ServiceKey, type IServiceProvider } from "@pragmatic-tech-ai/mural/runtime";
import type { IStorage } from "@pragmatic-tech-ai/todl-runtime";
import type { TodlBridge } from "../../env.js";
import { AppLocalStorage } from "./app-local-storage.js";

// Builds a rooted IStorage for a location (an absolute folder locally, a
// container id/URL remotely). Registered under a backend id.
export type StorageProviderFactory = (location: string) => IStorage;

// AppStorageProviderRegistry — maps a backend id → the factory that builds its
// storage. Satisfies the solution package's IStorageProviderRegistry: its
// CreateStorage(folder) calls Create('local', folder) to get the IStorage the
// SolutionManagerService hands to project factories.
// Mirrors Plexus's StorageProviderRegistry: one built-in backend, additional
// backends register against the same surface.
//
// The `'local'` backend builds an AppLocalStorage over the `window.todl` fs
// bridge, read the same way RegistryClient does (`__todlBridge` first, so an
// e2e can inject a fake; falling back to the deep-frozen `window.todl`).
export class AppStorageProviderRegistry extends ServiceBase {
  public static readonly Key = new ServiceKey<AppStorageProviderRegistry>("StorageProviderRegistry");
  public static readonly DefaultBackendId = "local";

  private readonly factories = new Map<string, StorageProviderFactory>();

  constructor(provider: IServiceProvider) {
    super(provider);
    this.Register(AppStorageProviderRegistry.DefaultBackendId, (location) => new AppLocalStorage(location, this.bridge().fs));
  }

  public Register(id: string, factory: StorageProviderFactory): void {
    this.factories.set(id, factory);
  }

  public Has(id: string): boolean {
    return this.factories.has(id);
  }

  // Build a rooted IStorage for a backend id. Throws for an unregistered id
  // (a project whose manifest names a backend this build doesn't ship).
  public Create(id: string, location: string): IStorage {
    const factory = this.factories.get(id);
    if (factory === undefined) throw new Error(`Unknown storage backend "${id}".`);
    return factory(location);
  }

  // Rooted IStorage for a folder using the default backend. Satisfies the
  // solution package's IStorageProviderRegistry so the SolutionManagerService
  // can root the solution + its members without knowing the backend id.
  public CreateStorage(location: string): IStorage {
    return this.Create(AppStorageProviderRegistry.DefaultBackendId, location);
  }

  private bridge(): TodlBridge {
    return (window as unknown as { __todlBridge?: TodlBridge }).__todlBridge ?? window.todl;
  }
}
