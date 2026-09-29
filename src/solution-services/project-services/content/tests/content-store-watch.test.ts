import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeStorage, FileChangeKind } from '@pragmatic-tech-ai/todl-runtime';
import { ProjectContentStore } from '../project-content-store.js';
import { ContentAdded, ContentRemoved, ContentUpdated, type ContentChange } from '../content-change.js';

async function watchedRoot(seed: (s: FakeStorage) => Promise<void>)
{
    const s = new FakeStorage();
    await seed(s);
    const store = new ProjectContentStore(s, { settleMs: 0 });
    const seen: ContentChange[] = [];
    store.ObserveChildren(store.Root.Id, (c) => seen.push(c));
    await store.WhenIdle();
    return { s, store, seen };
}

test('external create emits ContentAdded', async () =>
{
    const { s, seen } = await watchedRoot(async () => {});
    await s.WriteText('a.todl', '');
    s.EmitFileChange('a.todl', FileChangeKind.Added, false);
    await tick();
    assert.equal(seen.filter((c) => c instanceof ContentAdded).length, 1);
});

test('same-ino rename emits ContentUpdated with a stable id (not remove+add)', async () =>
{
    const { s, seen } = await watchedRoot(async (st) => { await st.WriteText('a.todl', ''); });
    const addedId = (seen.find((c) => c instanceof ContentAdded) as ContentAdded).Node.Id;
    await s.Rename('a.todl', 'b.todl');                          // FakeStorage carries the ino across
    s.EmitFileChange('a.todl', FileChangeKind.Removed, false);
    s.EmitFileChange('b.todl', FileChangeKind.Added, false);
    await tick();
    const updated = seen.filter((c): c is ContentUpdated => c instanceof ContentUpdated);
    assert.equal(updated.length, 1);
    assert.equal(updated[0]!.Node.Id, addedId);                 // SAME id
    assert.equal(updated[0]!.Node.Name, 'b.todl');
    assert.equal(seen.filter((c) => c instanceof ContentRemoved).length, 0);
});

test('add-before-unlink rename ordering still correlates to ContentUpdated', async () =>
{
    const { s, seen } = await watchedRoot(async (st) => { await st.WriteText('a.todl', ''); });
    const addedId = (seen.find((c) => c instanceof ContentAdded) as ContentAdded).Node.Id;
    await s.Rename('a.todl', 'b.todl');
    s.EmitFileChange('b.todl', FileChangeKind.Added, false);    // add first (Windows ordering)
    s.EmitFileChange('a.todl', FileChangeKind.Removed, false);  // unlink second
    await tick();
    const updated = seen.filter((c): c is ContentUpdated => c instanceof ContentUpdated);
    assert.equal(updated.length, 1);
    assert.equal(updated[0]!.Node.Id, addedId);
    assert.equal(seen.filter((c) => c instanceof ContentRemoved).length, 0);
});

test('ino-unavailable rename degrades to remove+add', async () =>
{
    const { s, seen } = await watchedRoot(async (st) => { await st.WriteText('a.todl', ''); });
    s.SetInoUnavailable('a.todl'); s.SetInoUnavailable('b.todl');
    await s.Rename('a.todl', 'b.todl');
    s.EmitFileChange('a.todl', FileChangeKind.Removed, false);
    s.EmitFileChange('b.todl', FileChangeKind.Added, false);
    await tick();
    assert.equal(seen.filter((c) => c instanceof ContentRemoved).length, 1);
    assert.equal(seen.filter((c) => c instanceof ContentAdded).length, 2);   // initial + the new one
});

test('inode reuse with a different kind is not merged', async () =>
{
    const { s, seen } = await watchedRoot(async (st) => { await st.WriteText('a.todl', ''); });
    await s.Delete('a.todl');
    await s.CreateDirectory('a.todl');                          // a dir reusing the freed name slot
    s.EmitFileChange('a.todl', FileChangeKind.Removed, false);
    s.EmitFileChange('a.todl', FileChangeKind.Added, true);     // IsDirectory = true
    await tick();
    assert.equal(seen.filter((c) => c instanceof ContentRemoved).length, 1);
    assert.equal(seen.filter((c) => c instanceof ContentUpdated).length, 0);  // kind differs → not a rename
});

test('deleting an expanded folder disposes its watcher and drops its state', async () =>
{
    const { s, store, seen } = await watchedRoot(async (st) => { await st.WriteText('sub/a.todl', ''); });
    const subId = (seen.find((c): c is ContentAdded => c instanceof ContentAdded && c.Node.Name === 'sub') as ContentAdded).Node.Id;
    const subSeen: ContentChange[] = [];
    store.ObserveChildren(subId, (c) => subSeen.push(c));       // expand 'sub' → starts its watcher
    await store.WhenIdle();
    assert.ok(subSeen.some((c) => c instanceof ContentAdded));  // saw a.todl
    const before = subSeen.length;

    await s.Delete('sub');
    s.EmitFileChange('sub', FileChangeKind.Removed, true);      // removed at the root level
    await tick();
    assert.equal(seen.filter((c) => c instanceof ContentRemoved && (c as ContentRemoved).Id === subId).length, 1);

    s.EmitFileChange('sub/c.todl', FileChangeKind.Added, false); // a late change into the gone folder
    await tick();
    assert.equal(subSeen.length, before);                       // watcher disposed → no post-removal delta
});

const tick = () => new Promise((r) => setTimeout(r, 5));       // settleMs is 0; one macrotask flush
