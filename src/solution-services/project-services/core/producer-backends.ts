import { ServiceKey, type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { PackageKind } from '../../../publish/publish.js'

// The seam that resolves the shared storage backend a producer package is published
// into and read back from — meta-models under one root, libraries under another. The
// concrete resolver registers these on the app's StorageService (rooted at
// <userData>/meta-models and <userData>/libraries today), so it is app-coupled and
// resolved here by key; todl owns only this contract. Each backend is a rooted
// IStorage; a package lives at `<id>/<version>/…` beneath it.
export interface IProducerStorageBackends
{
    // The backend for a producer kind. MetaModel/Library map to their two roots; any
    // other kind is a caller error.
    Backend(kind: PackageKind): IStorage
}

export const ProducerStorageBackendsKey = new ServiceKey<IProducerStorageBackends>('ProducerBackends')
