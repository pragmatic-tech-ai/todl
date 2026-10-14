import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { GraphQuery } from "../../graph-api/graph-query-engine.js";
import { FrozenGraph } from "../../domain/graph.js";
import { Manifest } from "../../manifest/reflection/reflection.js";
import { ManifestWriter } from "../../manifest/manifest-writer.js";
import type { LogicalManifest } from "../../manifest/logical.js";
import type { ReflectedNode } from "../../manifest/reflection/reflection.js";
import { GraphQueryAdapter } from "../graph.js";
import { CypherSemanticError } from "../errors.js";

class NamespacedGraphFixture
{
    public static Build(): GraphQuery
    {
        const empty = { fields: {}, relationships: {}, invariants: [], annotations: [] };
        const logical: LogicalManifest = {
            format: "todl-manifest/1", model: "svc", version: "1.0.0", root: "Element",
            concepts: {
                Element: { extends: null, ...empty },
                Plain: { extends: "Element", ...empty },
                "acme.Service": { extends: "Element", ...empty },
                "acme.CoreService": { extends: "acme.Service", ...empty },
                "one.Dup": { extends: "Element", ...empty },
                "two.Dup": { extends: "Element", ...empty },
            },
            classes: {}, taxonomies: {},
        };
        const g = new FrozenGraph();
        const m = Manifest.load(ManifestWriter.fromLogical(logical).toJSON());
        g.PreRegister(m);
        g.Finalize(m);
        const nodes: ReflectedNode[] = [
            { id: "p", type: "Plain", attrs: {} },
            { id: "s", type: "acme.Service", attrs: {} },
            { id: "c", type: "acme.CoreService", attrs: {} },
        ];
        g.BindSeed({ nodes, edges: [] }, { model: "svc", version: "1.0.0" });
        return new GraphQuery(g);
    }
}

describe("GraphQueryAdapter label resolution by simple name", () =>
{
    test("simple name matches a namespaced concept (inheritance-aware)", () =>
    {
        const a = new GraphQueryAdapter(NamespacedGraphFixture.Build());
        assert.deepEqual(a.NodesByLabel("Service").map((m) => m.node.id).sort(), ["c", "s"]);
        assert.deepEqual(a.NodesByLabel("CoreService").map((m) => m.node.id), ["c"]);
    });

    test("IsInstanceOf resolves by simple name", () =>
    {
        const a = new GraphQueryAdapter(NamespacedGraphFixture.Build());
        const c = a.Reflect("c")!;
        assert.equal(a.IsInstanceOf(c, "Service"), true);
        assert.equal(a.IsInstanceOf(c, "Plain"), false);
        assert.equal(a.IsInstanceOf(c, "Nope"), false);
    });

    test("unqualified concept still matches", () =>
    {
        const a = new GraphQueryAdapter(NamespacedGraphFixture.Build());
        assert.deepEqual(a.NodesByLabel("Plain").map((m) => m.node.id), ["p"]);
    });

    test("unknown label still throws", () =>
    {
        const a = new GraphQueryAdapter(NamespacedGraphFixture.Build());
        assert.throws(() => a.NodesByLabel("Nope"), /unknown label/);
    });

    test("ambiguous simple name throws", () =>
    {
        const a = new GraphQueryAdapter(NamespacedGraphFixture.Build());
        assert.throws(() => a.NodesByLabel("Dup"), (e: unknown) => e instanceof CypherSemanticError && /ambiguous label/.test(e.message));
    });
});
