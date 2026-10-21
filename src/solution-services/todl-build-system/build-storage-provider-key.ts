import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime';
import type { IBuildStorageProvider } from '../build-system-core/build-storage-provider.js';

// DI token for the build-output provider BuildService uses. Unregistered => BuildService
// falls back to InMemoryBuildStorage, so headless/unit/npm paths are unchanged; a host
// (Plexus) registers a disk-backed provider to land output on disk.
export const BuildStorageProviderKey = new ServiceKey<IBuildStorageProvider>('BuildStorageProvider');
