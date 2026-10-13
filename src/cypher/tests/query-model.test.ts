import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { NodePattern, RelPattern, PatternPath } from "../patterns.js";
import { MatchClause, ReturnItem } from "../query-model.js";
import { VariableRef, PropertyAccess } from "../expressions.js";
import { RelDirection } from "../enums.js";

describe("cypher query model", () =>
{
    test("MatchClause.DeclaredVariables collects named nodes and rels only", () =>
    {
        const a = new NodePattern("a", "Service", new Map());
        const anon = new NodePattern(undefined, "Service", new Map());
        const rel = new RelPattern("r", "calls", RelDirection.Outgoing, new Map());
        const match = new MatchClause([new PatternPath([a, anon], [rel])]);
        assert.deepEqual([...match.DeclaredVariables()].sort(), ["a", "r"]);
    });

    test("ReturnItem.ColumnName prefers alias, falls back to expression name", () =>
    {
        assert.equal(new ReturnItem(new PropertyAccess("a", "name"), undefined).ColumnName(), "a.name");
        assert.equal(new ReturnItem(new VariableRef("a"), "svc").ColumnName(), "svc");
    });
});
