import { test } from "node:test";
import assert from "node:assert/strict";
import { GraphApi } from "../graph-api.js";
import type { IGraphQuery } from "../graph-query.js";
import type { TodlDocument } from "../../compiler-services/emit/json.js";

// A GraphApi is an IGraphQuery (compile-time contract check).
const _contract: IGraphQuery = GraphApi.FromDocuments([]);
void _contract;

function conceptDoc(id: string): TodlDocument
{
    return {
        nodes: [{ id, tier: "Ontology", type: null, metaKind: "concept", namespace: "acme", localId: id, isClass: false, class: null, storageId: null, fields: [], attrs: {} }],
        edges: [],
    };
}

test("FromDocuments merges concepts from every document", () =>
{
    const api = GraphApi.FromDocuments([conceptDoc("Alpha"), conceptDoc("Beta")]);
    const ids = api.Concepts().map((c) => c.id).sort();
    assert.deepEqual(ids, ["Alpha", "Beta"]);
});

test("FromDocuments dedups colliding node ids (last wins)", () =>
{
    const api = GraphApi.FromDocuments([conceptDoc("Alpha"), conceptDoc("Alpha")]);
    assert.equal(api.Concepts().length, 1);
});

test("FromDocuments over an empty list yields an empty, non-throwing query", () =>
{
    const api = GraphApi.FromDocuments([]);
    assert.deepEqual(api.Concepts(), []);
    assert.deepEqual(api.Search("x"), []);
});
