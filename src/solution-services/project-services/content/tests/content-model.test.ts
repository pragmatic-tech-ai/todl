import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectNodeKind } from '../../core/project.js';
import { ProjectContentNode, type ContentNodeId } from '../content-node.js';
import { ContentAdded, ContentUpdated, ContentRemoved } from '../content-change.js';
import { ContentNodeKey } from '../content-node-key.js';

test('ProjectContentNode carries id/path/name/kind; rename raises Name/Path', () =>
{
    const n = new ProjectContentNode('n1' as ContentNodeId, 'src/a.todl', 'a.todl', ProjectNodeKind.Todl);
    let raised = 0;
    n.PropertyChanged('Name').subscribe(() => raised++);
    n.Name = 'b.todl';
    assert.equal(n.Name, 'b.todl');
    assert.equal(raised, 1);
});

test('ContentChange variants carry their payloads', () =>
{
    const n = new ProjectContentNode('n1' as ContentNodeId, 'a', 'a', ProjectNodeKind.File);
    assert.equal(new ContentAdded(n).Node, n);
    assert.equal(new ContentUpdated(n).Node, n);
    assert.equal(new ContentRemoved('n1' as ContentNodeId).Id, 'n1');
});

test('ContentNodeKey maps kinds to presentation families', () =>
{
    assert.equal(ContentNodeKey.For(ProjectNodeKind.Folder), ContentNodeKey.Folder);
    assert.equal(ContentNodeKey.For(ProjectNodeKind.Diagram), ContentNodeKey.Diagram);
});
