import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { NodeFsStorage } from '@pragmatic-tech-ai/todl-runtime/node';
import { ProjectContentStore } from '../project-content-store.js';
import { ProjectContentProvider } from '../project-content-provider.js';

// A real-filesystem harness for the content store: a NodeFsStorage rooted in a temp
// dir, a store + provider over it, and auto-cleanup registered on the test context.
export class ContentStoreTestHarness
{
    private constructor(
        public readonly Dir: string,
        public readonly Store: ProjectContentStore,
        public readonly Provider: ProjectContentProvider,
    ) {}

    public static async realFs(t: TestContext): Promise<ContentStoreTestHarness>
    {
        const dir = await mkdtemp(join(tmpdir(), 'content-store-'));
        const store = new ProjectContentStore(new NodeFsStorage(dir));   // real settle window
        const provider = new ProjectContentProvider(store);
        t.after(async () => { store.dispose(); await rm(dir, { recursive: true, force: true }); });
        return new ContentStoreTestHarness(dir, store, provider);
    }

    // Poll a condition instead of sleeping a fixed time (fs events are timing-sensitive).
    public async WaitFor(cond: () => boolean, timeoutMs = 5000): Promise<void>
    {
        const start = Date.now();
        while (!cond())
        {
            if (Date.now() - start > timeoutMs) throw new Error('condition not met in time');
            await new Promise((r) => setTimeout(r, 25));
        }
    }
}
