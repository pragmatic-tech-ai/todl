import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Graph, GraphChangeKind, type GraphChangeArgs } from '../graph.js';
import { Builder } from '../builder.js';

describe('Graph.remove', () =>
{
    test('removes the node, strips incident edges, and emits events', () =>
    {
        const g = new Graph();
        const b = new Builder(g);
        b.defineConcept('A').defineConcept('B').addConceptRelationship('A', 'uses', ['B']);
        b.assertInstance('A', 'a1').assertInstance('B', 'b1').addRelationship('a1', 'uses', 'b1');
        b.commit();

        const events: GraphChangeArgs[] = [];
        g.changed.subscribe((e) => events.push(e));

        g.remove('b1');

        assert.equal(g.getNode('b1'), undefined, 'node gone');
        assert.equal(g.outEdges('a1').filter((e) => e.to === 'b1').length, 0, 'incident edge from a1 stripped');
        assert.ok(events.some((e) => e.kind === GraphChangeKind.NodeRemoved && e.node === 'b1'), 'NodeRemoved emitted');
        assert.ok(events.some((e) => e.kind === GraphChangeKind.EdgeRemoved && e.target === 'b1'), 'EdgeRemoved emitted');
    });
});
