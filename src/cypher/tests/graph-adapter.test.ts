import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { GraphQuery } from "../../graph-api/graph-query-engine.js";
import { FrozenGraph } from "../../domain/graph.js";
import { Manifest } from "../../manifest/reflection/reflection.js";
import { ManifestWriter } from "../../manifest/manifest-writer.js";
import type { LogicalManifest } from "../../manifest/logical.js";
import type { ReflectedNode } from "../../manifest/reflection/reflection.js";
import { GraphQueryAdapter } from "../graph.js";
import { RelDirection } from "../enums.js";
import { CypherSemanticError } from "../errors.js";

class ServiceGraphFixture
{
    public static Build(mutual: boolean = false): GraphQuery
    {
        const logical: LogicalManifest = {
            format: "todl-manifest/1", model: "svc", version: "1.0.0", root: "Element",
            concepts: {
                Element: { extends: null, fields: {}, relationships: {}, invariants: [], annotations: [] },
                Service: {
                    extends: "Element",
                    fields: { name: { type: "string", card: "?" } },
                    relationships: { calls: { targets: ["Service"], card: "*", annotations: [] } },
                    invariants: [], annotations: [],
                },
                CoreService: { extends: "Service", fields: {}, relationships: {}, invariants: [], annotations: [] },
            },
            classes: {}, taxonomies: {},
        };
        const g = new FrozenGraph();
        const m = Manifest.load(ManifestWriter.fromLogical(logical).toJSON());
        g.PreRegister(m);
        g.Finalize(m);
        const nodes: ReflectedNode[] = [
            { id: "a", type: "Service", attrs: { name: "checkout" } },
            { id: "b", type: "CoreService", attrs: { name: "ledger" } },
        ];
        const edges = [{ from: "a", rel: "calls", to: "b" }];
        if (mutual)
        {
            edges.push({ from: "b", rel: "calls", to: "a" });
        }
        g.BindSeed({ nodes, edges }, { model: "svc", version: "1.0.0" });
        return new GraphQuery(g);
    }
}

describe("GraphQueryAdapter", () =>
{
    test("NodesByLabel is inheritance-aware", () =>
    {
        const a = new GraphQueryAdapter(ServiceGraphFixture.Build());
        assert.deepEqual(a.NodesByLabel("Service").map((m) => m.node.id).sort(), ["a", "b"]);
        assert.deepEqual(a.NodesByLabel("CoreService").map((m) => m.node.id), ["b"]);
    });

    test("unknown label throws CypherSemanticError (strict)", () =>
    {
        const a = new GraphQueryAdapter(ServiceGraphFixture.Build());
        assert.throws(() => a.NodesByLabel("Nope"), CypherSemanticError);
    });

    test("Expand follows direction; undirected de-duplicates", () =>
    {
        const a = new GraphQueryAdapter(ServiceGraphFixture.Build());
        assert.deepEqual(a.Expand("a", "calls", RelDirection.Outgoing).map((m) => m.node.id), ["b"]);
        assert.deepEqual(a.Expand("b", "calls", RelDirection.Incoming).map((m) => m.node.id), ["a"]);
        assert.deepEqual(a.Expand("a", "calls", RelDirection.Outgoing).length, 1);
        assert.deepEqual(a.Expand("a", "nomatch", RelDirection.Outgoing), []);
    });

    test("undirected Expand de-duplicates a node reachable both ways", () =>
    {
        const a = new GraphQueryAdapter(ServiceGraphFixture.Build(true));
        assert.deepEqual(a.Expand("a", "calls", RelDirection.Outgoing).map((m) => m.node.id), ["b"]);
        assert.deepEqual(a.Expand("a", "calls", RelDirection.Incoming).map((m) => m.node.id), ["b"]);
        const ids = a.Expand("a", "calls", RelDirection.Undirected).map((m) => m.node.id);
        assert.equal(ids.length, 1);
        assert.deepEqual(ids, ["b"]);
    });

    test("unlabelled Expand unions the node's relationships, including inherited", () =>
    {
        const a = new GraphQueryAdapter(ServiceGraphFixture.Build(true));
        assert.deepEqual(a.Expand("a", undefined, RelDirection.Outgoing).map((m) => m.node.id), ["b"]);
        assert.deepEqual(a.Expand("b", undefined, RelDirection.Outgoing).map((m) => m.node.id), ["a"]);
    });

    test("HasRelationshipType and IsInstanceOf", () =>
    {
        const a = new GraphQueryAdapter(ServiceGraphFixture.Build());
        assert.equal(a.HasRelationshipType("calls"), true);
        assert.equal(a.HasRelationshipType("ghost"), false);
        const b = a.NodesByLabel("CoreService")[0];
        assert.equal(a.IsInstanceOf(b, "Service"), true);
        assert.equal(a.IsInstanceOf(b, "CoreService"), true);
    });
});
