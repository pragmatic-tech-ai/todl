import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, rename, rm as rmFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ChildAdded, ChildUpdated, ChildRemoved, type HierarchyChange } from '@pragmatic-tech-ai/mural/framework/hierarchy';
import { ContentStoreTestHarness } from './content-store-harness.js';

test('a file created on disk surfaces as ChildAdded; rename → ChildUpdated (stable id); delete → ChildRemoved', async (t) =>
{
    const h = await ContentStoreTestHarness.realFs(t);
    const seen: HierarchyChange[] = [];
    const rootId = h.Provider.ParseCanonicalName('');
    h.Provider.ObserveChildren(rootId, (c) => seen.push(c));
    await h.Store.WhenIdle();
    // chokidar ignores files that appear during its initial scan and readiness is not
    // observable through the store — allow a bounded init window before the first write.
    await new Promise((r) => setTimeout(r, 800));

    await writeFile(join(h.Dir, 'a.todl'), '');
    await h.WaitFor(() => seen.some((c) => c instanceof ChildAdded));
    const id = (seen.find((c) => c instanceof ChildAdded) as ChildAdded).Id;

    await rename(join(h.Dir, 'a.todl'), join(h.Dir, 'b.todl'));
    await h.WaitFor(() => seen.some((c) => c instanceof ChildUpdated));
    assert.equal((seen.find((c) => c instanceof ChildUpdated) as ChildUpdated).Id, id);   // same id across a real rename

    await rmFile(join(h.Dir, 'b.todl'));
    await h.WaitFor(() => seen.some((c) => c instanceof ChildRemoved));
});
