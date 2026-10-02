import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, rename, rm as rmFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { NodeFsStorage } from '@pragmatic-tech-ai/todl-runtime/node';
import { ProjectContentStore } from '../project-content-store.js';
import { ContentAdded, ContentUpdated, ContentRemoved, type ContentChange } from '../content-change.js';

// A real-filesystem harness for the content store: a NodeFsStorage rooted in a temp
// dir, with auto-cleanup registered on the test context.
class RealFsContentStoreHarness
{
    private static readonly TempDirPrefix = 'content-store-';
    private static readonly DefaultTimeoutMs = 5000;
    private static readonly PollIntervalMs = 25;
    private static readonly TimeoutMessage = 'condition not met in time';

    private constructor(
        public readonly Dir: string,
        public readonly Store: ProjectContentStore,
    ) {}

    public static async Create(t: TestContext): Promise<RealFsContentStoreHarness>
    {
        const dir = await mkdtemp(join(tmpdir(), RealFsContentStoreHarness.TempDirPrefix));
        const store = new ProjectContentStore(new NodeFsStorage(dir));   // real settle window
        t.after(async () => { store.dispose(); await rm(dir, { recursive: true, force: true }); });
        return new RealFsContentStoreHarness(dir, store);
    }

    // Poll a condition instead of sleeping a fixed time (fs events are timing-sensitive).
    public async WaitFor(condition: () => boolean, timeoutMs = RealFsContentStoreHarness.DefaultTimeoutMs): Promise<void>
    {
        const start = Date.now();
        while (!condition())
        {
            if (Date.now() - start > timeoutMs) throw new Error(RealFsContentStoreHarness.TimeoutMessage);
            await new Promise((r) => setTimeout(r, RealFsContentStoreHarness.PollIntervalMs));
        }
    }
}

test('a file created on disk surfaces as ContentAdded; rename → ContentUpdated (stable id); delete → ContentRemoved', async (t) =>
{
    const h = await RealFsContentStoreHarness.Create(t);
    const seen: ContentChange[] = [];
    h.Store.ObserveChildren(h.Store.Root.Id, (c) => seen.push(c));
    await h.Store.WhenIdle();
    // chokidar ignores files that appear during its initial scan and readiness is not
    // observable through the store — allow a bounded init window before the first write.
    await new Promise((r) => setTimeout(r, 800));

    await writeFile(join(h.Dir, 'a.todl'), '');
    await h.WaitFor(() => seen.some((c) => c instanceof ContentAdded));
    const id = (seen.find((c) => c instanceof ContentAdded) as ContentAdded).Node.Id;

    await rename(join(h.Dir, 'a.todl'), join(h.Dir, 'b.todl'));
    await h.WaitFor(() => seen.some((c) => c instanceof ContentUpdated));
    assert.equal((seen.find((c) => c instanceof ContentUpdated) as ContentUpdated).Node.Id, id);   // same id across a real rename

    await rmFile(join(h.Dir, 'b.todl'));
    await h.WaitFor(() => seen.some((c) => c instanceof ContentRemoved));
});
