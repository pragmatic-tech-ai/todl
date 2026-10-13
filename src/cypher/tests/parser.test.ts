import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CypherParser } from "../parser.js";
import { MatchClause } from "../query-model.js";
import { RelDirection } from "../enums.js";
import { CypherSyntaxError } from "../errors.js";

describe("cypher parser", () =>
{
    test("parses labelled nodes, a directed rel, WHERE, and RETURN", () =>
    {
        const model = new CypherParser(
            "MATCH (a:Service)-[:calls]->(b:Service) WHERE a.name = 'checkout' RETURN b, b.name AS n",
        ).Parse();
        const match = model.Parts[0]!.Reading[0] as MatchClause;
        const path = match.Paths[0]!;
        assert.equal(path.Nodes.length, 2);
        assert.equal(path.Nodes[0]!.Variable, "a");
        assert.equal(path.Nodes[0]!.Label, "Service");
        assert.equal(path.Rels[0]!.RelType, "calls");
        assert.equal(path.Rels[0]!.Direction, RelDirection.Outgoing);
        assert.ok(match.Where !== undefined);
        assert.equal(model.Parts[0]!.Projection.Items.length, 2);
        assert.equal(model.Parts[0]!.Projection.Items[1]!.Alias, "n");
    });

    test("undirected and incoming relationships", () =>
    {
        const u = new CypherParser("MATCH (a)-[:x]-(b) RETURN a").Parse();
        assert.equal((u.Parts[0]!.Reading[0] as MatchClause).Paths[0]!.Rels[0]!.Direction, RelDirection.Undirected);
        const inc = new CypherParser("MATCH (a)<-[:x]-(b) RETURN a").Parse();
        assert.equal((inc.Parts[0]!.Reading[0] as MatchClause).Paths[0]!.Rels[0]!.Direction, RelDirection.Incoming);
    });

    test("node inline property map becomes model properties", () =>
    {
        const model = new CypherParser("MATCH (a:Service {name: 'checkout'}) RETURN a").Parse();
        const match = model.Parts[0]!.Reading[0] as MatchClause;
        assert.equal(match.Paths[0]!.Nodes[0]!.Properties.get("name"), "checkout");
    });

    test("empty source raises CypherSyntaxError", () =>
    {
        assert.throws(() => new CypherParser("").Parse(), CypherSyntaxError);
    });

    test("MATCH without RETURN raises CypherSyntaxError with a position", () =>
    {
        assert.throws(() => new CypherParser("MATCH (a)").Parse(), (e: unknown) =>
        {
            return e instanceof CypherSyntaxError && e.Line >= 1;
        });
    });
});
