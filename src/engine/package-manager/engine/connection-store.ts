import { ServiceKey } from '@pragmatic-tech-ai/todl-runtime'
import { type ConnectionSpec } from './registry-connection.js'

// The host seam that PERSISTS connection specs (no secrets — those go to
// ISecretStore). A real interface with a real implementing class: the app supplies
// a concrete (Plexus devUI's connection store over disk / settings), a test
// supplies a fake. Async throughout so a disk- or IPC-backed host fits.
export interface IConnectionStore
{
    All(): Promise<readonly ConnectionSpec[]>
    Get(id: string): Promise<ConnectionSpec | undefined>
    Save(spec: ConnectionSpec): Promise<void>
    Delete(id: string): Promise<void>
    // The default connection id (used by non-connection-scoped ops), or undefined
    // when there are no connections. Persisted alongside the specs by the host.
    DefaultId(): Promise<string | undefined>
    SetDefault(id: string): Promise<void>
}

// The container key the connection store registers under. A standalone const (not
// only a static on PackageManagerService) so a module's `.services:` markup can
// name it directly in the `Impl -> Token` form.
export const ConnectionStoreKey = new ServiceKey<IConnectionStore>('PackageConnectionStore')
