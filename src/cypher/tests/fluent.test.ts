import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CypherQuery, Pattern, Expr, Return } from "../fluent.js";
import { CypherParser } from "../parser.js";
import { RelDirection } from "../enums.js";

describe("cypher fluent builder", () =>
{
    test("builder produces the same model as the equivalent text", () =>
    {
        const built = CypherQuery
            .Match(Pattern.Node("a").Label("Service").Out("calls", Pattern.Node("b").Label("Service")))
            .Where(Expr.Prop("a", "name").Eq("checkout"))
            .Return(Return.Node("b"), Return.Prop("b", "name", "n"))
            .ToModel();
        const parsed = new CypherParser(
            "MATCH (a:Service)-[:calls]->(b:Service) WHERE a.name = 'checkout' RETURN b, b.name AS n",
        ).Parse();

        assert.equal(built.Match.Paths.length, parsed.Match.Paths.length);
        const bp = built.Match.Paths[0]!;
        const pp = parsed.Match.Paths[0]!;
        assert.equal(bp.Nodes[0]!.Label, pp.Nodes[0]!.Label);
        assert.equal(bp.Nodes[0]!.Variable, pp.Nodes[0]!.Variable);
        assert.equal(bp.Rels[0]!.RelType, pp.Rels[0]!.RelType);
        assert.equal(bp.Rels[0]!.Direction, RelDirection.Outgoing);
        assert.equal(built.Return.Items[1]!.ColumnName(), parsed.Return.Items[1]!.ColumnName());
        assert.ok(built.Where !== undefined && parsed.Where !== undefined);
    });
});
