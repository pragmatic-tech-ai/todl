import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeStorage, FileChangeKind } from '@pragmatic-tech-ai/todl-runtime';
import { ProjectContentStore } from '../project-content-store.js';
import { ContentAdded, type ContentChange } from '../content-change.js';

const tick = () => new Promise((r) => setTimeout(r, 5));

function names(seen: ContentChange[]): string[]
{
    return seen.filter((c): c is ContentAdded => c instanceof ContentAdded).map((c) => c.Node.Name).sort();
}

test('concurrent subscribe before load resolves does not double-load or duplicate deltas', async () =>
{
    const s = new FakeStorage();
    await s.WriteText('a.todl', '');
    const store = new ProjectContentStore(s, { settleMs: 0 });
    const s1: ContentChange[] = [];
    const s2: ContentChange[] = [];
    store.ObserveChildren(store.Root.Id, (c) => s1.push(c));
    store.ObserveChildren(store.Root.Id, (c) => s2.push(c));   // second subscriber while load in flight
    await store.WhenIdle();
    assert.equal(s1.filter((c) => c instanceof ContentAdded).length, 1);
    assert.equal(s2.filter((c) => c instanceof ContentAdded).length, 1);   // each sink once, one load
});

test('re-subscribe after collapse re-lists (new file seen) and restarts the watcher', async () =>
{
    const s = new FakeStorage();
    await s.WriteText('a.todl', '');
    const store = new ProjectContentStore(s, { settleMs: 0 });
    const off = store.ObserveChildren(store.Root.Id, () => {});
    await store.WhenIdle();
    off();                                                     // collapse
    await s.WriteText('b.todl', '');                           // created while collapsed
    const second: ContentChange[] = [];
    store.ObserveChildren(store.Root.Id, (c) => second.push(c));
    await store.WhenIdle();
    assert.deepEqual(names(second), ['a.todl', 'b.todl']);     // re-list caught the new file
    await s.WriteText('c.todl', '');
    s.EmitFileChange('c.todl', FileChangeKind.Added, false);   // watcher restarted → live add flows
    await tick();
    assert.ok(second.some((c) => c instanceof ContentAdded && c.Node.Name === 'c.todl'));
});

test('deleting an expanded folder recursively drops descendant nodes and disposes their watchers', async () =>
{
    const s = new FakeStorage();
    await s.WriteText('sub/deep/x.todl', '');
    const store = new ProjectContentStore(s, { settleMs: 0 });
    const root: ContentChange[] = [];
    store.ObserveChildren(store.Root.Id, (c) => root.push(c));
    await store.WhenIdle();
    const subId = (root.find((c): c is ContentAdded => c instanceof ContentAdded && c.Node.Name === 'sub') as ContentAdded).Node.Id;
    const subSeen: ContentChange[] = [];
    store.ObserveChildren(subId, (c) => subSeen.push(c));
    await store.WhenIdle();
    const deepId = (subSeen.find((c): c is ContentAdded => c instanceof ContentAdded && c.Node.Name === 'deep') as ContentAdded).Node.Id;
    const deepSeen: ContentChange[] = [];
    store.ObserveChildren(deepId, (c) => deepSeen.push(c));
    await store.WhenIdle();
    const xId = (deepSeen.find((c): c is ContentAdded => c instanceof ContentAdded) as ContentAdded).Node.Id;
    assert.ok(store.NodeById(xId) !== undefined);

    await s.Delete('sub');
    s.EmitFileChange('sub', FileChangeKind.Removed, true);
    await tick();
    assert.equal(store.NodeById(deepId), undefined);           // descendant folder node gone
    assert.equal(store.NodeById(xId), undefined);              // grandchild node gone
    const before = deepSeen.length;
    s.EmitFileChange('sub/deep/y.todl', FileChangeKind.Added, false);   // late change into gone subtree
    await tick();
    assert.equal(deepSeen.length, before);                     // its watcher was disposed
});

test('renaming an expanded folder rewrites descendant paths and keeps the watcher live', async () =>
{
    const s = new FakeStorage();
    await s.WriteText('src/main.todl', '');
    const store = new ProjectContentStore(s, { settleMs: 0 });
    const root: ContentChange[] = [];
    store.ObserveChildren(store.Root.Id, (c) => root.push(c));
    await store.WhenIdle();
    const srcId = (root.find((c): c is ContentAdded => c instanceof ContentAdded && c.Node.Name === 'src') as ContentAdded).Node.Id;
    const srcSeen: ContentChange[] = [];
    store.ObserveChildren(srcId, (c) => srcSeen.push(c));
    await store.WhenIdle();
    const mainId = (srcSeen.find((c): c is ContentAdded => c instanceof ContentAdded) as ContentAdded).Node.Id;

    await s.Rename('src', 'lib');
    s.EmitFileChange('lib', FileChangeKind.Added, true);       // rename target (dir)
    s.EmitFileChange('src', FileChangeKind.Removed, true);     // rename source (dir)
    await tick();
    assert.equal(store.NodeById(srcId)!.Path, 'lib');          // folder path updated (same id)
    assert.equal(store.NodeById(mainId)!.Path, 'lib/main.todl'); // descendant path rewritten

    const before = srcSeen.length;
    await s.WriteText('lib/new.todl', '');
    s.EmitFileChange('lib/new.todl', FileChangeKind.Added, false);   // watcher live on the new path
    await tick();
    assert.ok(srcSeen.some((c) => c instanceof ContentAdded && c.Node.Name === 'new.todl'));
});
