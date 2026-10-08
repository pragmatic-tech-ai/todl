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

test('the root project.plexus manifest is hidden, but a nested same-named file is not', async () =>
{
    const s = new FakeStorage();
    await s.WriteText('project.plexus', '{}');          // the manifest — hidden at root
    await s.WriteText('a.todl', '');
    await s.WriteText('sub/project.plexus', '');         // NOT the manifest — a nested file, kept
    const store = new ProjectContentStore(s);

    const roots = new Map<string, ContentNodeId>();
    store.ObserveChildren(store.Root.Id, (c) => { if (c instanceof ContentAdded) roots.set(c.Node.Name, c.Node.Id); });
    await store.WhenIdle();
    assert.deepEqual([...roots.keys()].sort(), ['a.todl', 'sub']);   // no project.plexus at the root

    const subNames: string[] = [];
    store.ObserveChildren(roots.get('sub')!, (c) => { if (c instanceof ContentAdded) subNames.push(c.Node.Name); });
    await store.WhenIdle();
    assert.deepEqual(subNames, ['project.plexus']);          // nested file is a real content node
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
