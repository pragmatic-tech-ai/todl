import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeStorage, FileChangeKind } from '@pragmatic-tech-ai/todl-runtime';
import { ProjectContentStore } from '../project-content-store.js';
import { ContentAdded, ContentUpdated, ContentRemoved, type ContentChange } from '../content-change.js';

const tick = () => new Promise((r) => setTimeout(r, 5));

async function rootStore(seed: (s: FakeStorage) => Promise<void> = async () => {})
{
    const s = new FakeStorage();
    await seed(s);
    const store = new ProjectContentStore(s, { settleMs: 0 });
    const seen: ContentChange[] = [];
    store.ObserveChildren(store.Root.Id, (c) => seen.push(c));
    await store.WhenIdle();
    return { s, store, seen };
}

test('CreateFile writes at the child path and the watcher yields ContentAdded', async () =>
{
    const { s, store, seen } = await rootStore();
    await store.CreateFile(store.Root.Id, 'new.todl', '');
    assert.equal(await s.ReadText('new.todl'), '');
    s.EmitFileChange('new.todl', FileChangeKind.Added, false);
    await tick();
    const added = seen.filter((c): c is ContentAdded => c instanceof ContentAdded);
    assert.equal(added.at(-1)!.Node.Name, 'new.todl');
});

test('Rename issues a disk rename → single ContentUpdated with the same id', async () =>
{
    const { s, store, seen } = await rootStore(async (st) => { await st.WriteText('a.todl', ''); });
    s.EmitFileChange('a.todl', FileChangeKind.Added, false); await tick();
    const id = (seen.find((c) => c instanceof ContentAdded) as ContentAdded).Node.Id;
    await store.Rename(id, 'b.todl');
    s.EmitFileChange('a.todl', FileChangeKind.Removed, false);
    s.EmitFileChange('b.todl', FileChangeKind.Added, false);
    await tick();
    const upd = seen.filter((c): c is ContentUpdated => c instanceof ContentUpdated);
    assert.equal(upd.at(-1)!.Node.Id, id);
    assert.equal(upd.at(-1)!.Node.Name, 'b.todl');
});

test('Rename to empty or slashed name is rejected and does not touch disk', async () =>
{
    const { s, store, seen } = await rootStore(async (st) => { await st.WriteText('a.todl', ''); });
    s.EmitFileChange('a.todl', FileChangeKind.Added, false); await tick();
    const id = (seen.find((c) => c instanceof ContentAdded) as ContentAdded).Node.Id;
    await assert.rejects(() => store.Rename(id, ''));
    await assert.rejects(() => store.Rename(id, 'a/b'));
    assert.equal(await s.ReadText('a.todl'), '');   // still there, untouched
});

test('Delete removes on disk → ContentRemoved', async () =>
{
    const { s, store, seen } = await rootStore(async (st) => { await st.WriteText('a.todl', ''); });
    s.EmitFileChange('a.todl', FileChangeKind.Added, false); await tick();
    const id = (seen.find((c) => c instanceof ContentAdded) as ContentAdded).Node.Id;
    await store.Delete(id);
    s.EmitFileChange('a.todl', FileChangeKind.Removed, false);
    await tick();
    assert.equal(seen.filter((c) => c instanceof ContentRemoved).length, 1);
});
