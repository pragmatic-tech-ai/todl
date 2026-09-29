import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeStorage, FileChangeKind } from '@pragmatic-tech-ai/todl-runtime';
import { ChildAdded, HierarchyItemId, type HierarchyChange } from '@pragmatic-tech-ai/mural/framework/hierarchy';
import { ProjectContentStore } from '../project-content-store.js';
import { ProjectContentProvider } from '../project-content-provider.js';

test('maps ContentAdded → ChildAdded carrying a minted, reused HierarchyItemId', async () =>
{
    const s = new FakeStorage();
    await s.WriteText('a.todl', '');
    const store = new ProjectContentStore(s, { settleMs: 0 });
    const provider = new ProjectContentProvider(store);
    const rootId = provider.ParseCanonicalName('');            // the provider's root handle (path '')
    const seen: HierarchyChange[] = [];
    provider.ObserveChildren(rootId, (c) => seen.push(c));
    await store.WhenIdle();
    const added = seen.filter((c): c is ChildAdded => c instanceof ChildAdded);
    assert.equal(added.length, 1);
    const a = added[0]!;
    assert.equal(a.Node.Caption, 'a.todl');
    assert.equal(a.Node.Key, 'todl');
    assert.ok(a.Id instanceof HierarchyItemId);
    // GetCanonicalName round-trips to the SAME id instance
    const name = provider.GetCanonicalName(a.Id);
    assert.equal(provider.ParseCanonicalName(name), a.Id);
});

test('ParseCanonicalName returns Nil after the node is removed (maps pruned)', async () =>
{
    const s = new FakeStorage();
    await s.WriteText('a.todl', '');
    const store = new ProjectContentStore(s, { settleMs: 0 });
    const provider = new ProjectContentProvider(store);
    provider.ObserveChildren(provider.ParseCanonicalName(''), () => {});
    await store.WhenIdle();
    assert.notEqual(provider.ParseCanonicalName('a.todl'), HierarchyItemId.Nil);

    await s.Delete('a.todl');
    s.EmitFileChange('a.todl', FileChangeKind.Removed, false);
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(provider.ParseCanonicalName('a.todl'), HierarchyItemId.Nil);   // pruned on removal
});
