import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CypherParser } from "../parser.js";
import { SetMode } from "../enums.js";
import { CypherSyntaxError } from "../errors.js";
import { LogicalPlanner } from "../planner.js";
import { ReferencedLabels } from "../referenced-labels.js";
import {
    CreateClause, MergeClause, MatchClause, SetClause, DeleteClause, RemoveClause, ProjectionClause,
} from "../query-model.js";

class P
{
    public static Parse(src: string)
    {
        return new CypherParser(src).Parse();
    }
}

describe("cypher write parse", () =>
{
    it("CREATE a node pattern parses to a CreateClause", () =>
    {
        const m = P.Parse("CREATE (n:shop.Customer {name: 'Ada'})");
        assert.equal(m.Parts.length, 1);
        const c = m.Parts[0]!.Reading[0];
        assert.ok(c instanceof CreateClause);
        assert.equal(c.Paths.length, 1);
        const node = c.Paths[0]!.Nodes[0]!;
        assert.equal(node.Label, "shop.Customer");
        assert.equal(node.Properties.get("name"), "Ada");
        assert.equal(m.Parts[0]!.Projection, undefined);
        assert.equal(m.HasWrites(), true);
        assert.deepEqual(m.FinalColumns(), []);
    });

    it("CREATE a relationship pattern parses", () =>
    {
        const m = P.Parse("MATCH (a:shop.Customer) CREATE (a)-[:orders]->(o:shop.Order)");
        const r = m.Parts[0]!.Reading;
        assert.ok(r[0] instanceof MatchClause);
        assert.ok(r[1] instanceof CreateClause);
        assert.equal(r[1].Paths[0]!.Rels.length, 1);
        assert.equal(r[1].Paths[0]!.Rels[0]!.RelType, "orders");
    });

    it("MERGE parses to a single-node MergeClause", () =>
    {
        const m = P.Parse("MERGE (c:shop.Customer {email: 'a@b.c'})");
        const c = m.Parts[0]!.Reading[0];
        assert.ok(c instanceof MergeClause);
        assert.equal(c.Pattern.Nodes[0]!.Label, "shop.Customer");
        assert.deepEqual(c.DeclaredVariables(), ["c"]);
    });

    it("SET property and += map parse", () =>
    {
        const m = P.Parse("MATCH (n:shop.Customer) SET n.tier = 'gold', n += {active: true}");
        const c = m.Parts[0]!.Reading[1];
        assert.ok(c instanceof SetClause);
        assert.equal(c.Items.length, 2);
        assert.equal(c.Items[0]!.Mode, SetMode.Property);
        assert.equal(c.Items[0]!.Property, "tier");
        assert.equal(c.Items[1]!.Mode, SetMode.MergeMap);
        assert.equal(c.Items[1]!.Property, undefined);
    });

    it("DELETE and DETACH DELETE parse", () =>
    {
        const d = P.Parse("MATCH (n:shop.Order) DELETE n").Parts[0]!.Reading[1];
        assert.ok(d instanceof DeleteClause);
        assert.equal(d.Detach, false);
        const dd = P.Parse("MATCH (n:shop.Customer) DETACH DELETE n").Parts[0]!.Reading[1];
        assert.ok(dd instanceof DeleteClause);
        assert.equal(dd.Detach, true);
    });

    it("REMOVE a property parses", () =>
    {
        const c = P.Parse("MATCH (n:shop.Customer) REMOVE n.tier").Parts[0]!.Reading[1];
        assert.ok(c instanceof RemoveClause);
        assert.equal(c.Items.length, 1);
        assert.equal(c.Items[0]!.Variable, "n");
        assert.equal(c.Items[0]!.Property, "tier");
    });

    it("a write-only query needs no RETURN", () =>
    {
        const m = P.Parse("CREATE (n:shop.Customer {name: 'x'})");
        assert.equal(m.Parts[0]!.Projection, undefined);
    });

    it("MATCH ... SET ... RETURN keeps the projection", () =>
    {
        const m = P.Parse("MATCH (n:shop.Customer) SET n.tier = 'gold' RETURN n");
        assert.ok(m.Parts[0]!.Projection instanceof ProjectionClause);
        assert.deepEqual(m.FinalColumns(), ["n"]);
    });

    it("relationship properties in CREATE are rejected", () =>
    {
        assert.throws(() => P.Parse("CREATE (a)-[:orders {qty: 2}]->(b)"), CypherSyntaxError);
    });

    it("MERGE with a relationship path is rejected", () =>
    {
        assert.throws(() => P.Parse("MERGE (a)-[:r]->(b)"), CypherSyntaxError);
    });

    it("a keyword-spelled label parses on the read path", () =>
    {
        const m = P.Parse("MATCH (o:shop.Order) RETURN o");
        const c = m.Parts[0]!.Reading[0];
        assert.ok(c instanceof MatchClause);
        assert.equal(c.Paths[0]!.Nodes[0]!.Label, "shop.Order");
    });

    it("DETACH without DELETE is a syntax error", () =>
    {
        assert.throws(() => P.Parse("MATCH (n:shop.Customer) DETACH n"), CypherSyntaxError);
    });

    it("keyword spellings are valid property names and map keys", () =>
    {
        const m = P.Parse("MATCH (n:shop.Customer {delete: true}) SET n.set = n.create REMOVE n.merge RETURN n.remove");
        assert.equal(m.Parts.length, 1);
        assert.throws(() => P.Parse("MATCH (set) RETURN set"), CypherSyntaxError);
    });

    it("an unexecutable write clause fails planning loudly", () =>
    {
        assert.throws(() => new LogicalPlanner({} as never, new Map()).Plan(P.Parse("MATCH (n) DELETE n")));
    });

    it("ReferencedLabels includes CREATE/MERGE labels", () =>
    {
        assert.deepEqual(ReferencedLabels.Of("CREATE (n:shop.Customer)").labels, ["shop.Customer"]);
        assert.deepEqual(ReferencedLabels.Of("MERGE (n:shop.Order {id: 'x'})").labels, ["shop.Order"]);
    });
});
