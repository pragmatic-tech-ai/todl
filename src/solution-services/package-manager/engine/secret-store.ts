import { ServiceKey } from '@pragmatic-tech-ai/todl-runtime'

// The host seam that stores secrets — a simple key→secret pair (the key is a
// connection Id; the secret is that connection's token). Kept separate from
// IConnectionStore so the persisted ConnectionSpec never carries a secret and a
// host can back secrets with an OS keychain / encrypted store independently. The
// app supplies a concrete (Plexus devUI's token store over safe-storage), a test
// supplies a fake.
export interface ISecretStore
{
    Get(key: string): Promise<string | undefined>
    Set(key: string, secret: string): Promise<void>
    Delete(key: string): Promise<void>
}

// The container key the secret store registers under (standalone const, so a
// module's `.services:` markup can name it in the `Impl -> Token` form).
export const SecretStoreKey = new ServiceKey<ISecretStore>('PackageSecretStore')
