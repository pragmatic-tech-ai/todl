import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime';
import { HierarchyItemId, HierarchyItemsDrop, ChildAdded, type HierarchyChange } from '@pragmatic-tech-ai/mural/framework/hierarchy';
import { ProjectContentStore } from '../project-content-store.js';
import { ProjectContentProvider } from '../project-content-provider.js';

test('CanAccept: only a folder target accepts a same-provider item; rejects self/descendant/foreign', async () =>
{
    const s = new FakeStorage();
    await s.CreateDirectory('dir');
    await s.WriteText('a.todl', '');
    const store = new ProjectContentStore(s, { settleMs: 0 });
    const provider = new ProjectContentProvider(store);
    const ids = new Map<string, HierarchyItemId>();
    provider.ObserveChildren(provider.ParseCanonicalName(''), (c: HierarchyChange) =>
    { if (c instanceof ChildAdded) ids.set((c.Node.ExtObject as { Path: string }).Path, c.Id); });
    await store.WhenIdle();

    const dir = ids.get('dir')!;
    const file = ids.get('a.todl')!;
    assert.equal(provider.CanAccept(dir, HierarchyItemsDrop.For([file])), true);          // file → folder
    assert.equal(provider.CanAccept(file, HierarchyItemsDrop.For([file])), false);         // target not a folder
    assert.equal(provider.CanAccept(dir, HierarchyItemsDrop.For([dir])), false);           // onto itself
    assert.equal(provider.CanAccept(dir, HierarchyItemsDrop.For([HierarchyItemId.Mint()])), false); // foreign id
    assert.equal(provider.CanAccept(dir, { Kind: 'other', Payload: undefined }), false);   // wrong kind
});
