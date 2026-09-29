import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime';
import { ProjectContentStore } from '../project-content-store.js';
import { ContentAdded, type ContentChange } from '../content-change.js';
import { type ContentNodeId } from '../content-node.js';

async function seeded(): Promise<FakeStorage>
{
    const s = new FakeStorage();
    await s.WriteText('a.todl', '');
    await s.WriteText('sub/b.todl', '');
    return s;
}

test('subscribing to the root lazily lists one level and replays ContentAdded per child', async () =>
{
    const store = new ProjectContentStore(await seeded());
    const seen: ContentChange[] = [];
    store.ObserveChildren(store.Root.Id, (c) => seen.push(c));
    await store.WhenIdle();                                       // let the async load settle
    const names = seen.filter((c): c is ContentAdded => c instanceof ContentAdded).map((c) => c.Node.Name).sort();
    assert.deepEqual(names, ['a.todl', 'sub']);                  // one level only (not b.todl)
});

test('re-subscribing after dispose reuses the same ContentNodeIds', async () =>
{
    const store = new ProjectContentStore(await seeded());
    const first: ContentNodeId[] = [];
    const off = store.ObserveChildren(store.Root.Id, (c) => { if (c instanceof ContentAdded) first.push(c.Node.Id); });
    await store.WhenIdle();
    off();
    const second: ContentNodeId[] = [];
    store.ObserveChildren(store.Root.Id, (c) => { if (c instanceof ContentAdded) second.push(c.Node.Id); });
    await store.WhenIdle();
    assert.deepEqual([...second].sort(), [...first].sort());     // identity survives collapse/re-expand
});
