import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { GraphQuery } from "../../graph-api/graph-query-engine.js";
import { FrozenGraph } from "../../domain/graph.js";
import { Manifest } from "../../manifest/reflection/reflection.js";
import { ManifestWriter } from "../../manifest/manifest-writer.js";
import type { ConceptDef, LogicalManifest } from "../../manifest/logical.js";
import type { ReflectedNode } from "../../manifest/reflection/reflection.js";
import { CypherEngine } from "../engine.js";
import { NodeValue } from "../values.js";
import { CypherSemanticError } from "../errors.js";

class QualifiedLabelFixture
{
    public static Engine(): CypherEngine
    {
        const empty = { fields: {}, relationships: {}, invariants: [], annotations: [] };
        const named: ConceptDef = { extends: "Element", fields: { name: { type: "string", card: "?" } }, relationships: {}, invariants: [], annotations: [] };
        const logical: LogicalManifest = {
            format: "todl-manifest/1", model: "svc", version: "1.0.0", root: "Element",
            concepts: {
                Element: { extends: null, ...empty },
                "shop.Customer": named,
                "crm.Customer": named,
                "a.b.C": { extends: "Element", ...empty },
            },
            classes: {}, taxonomies: {},
        };
        const g = new FrozenGraph();
        const m = Manifest.load(ManifestWriter.fromLogical(logical).toJSON());
        g.PreRegister(m);
        g.Finalize(m);
        const nodes: ReflectedNode[] = [
            { id: "s1", type: "shop.Customer", attrs: { name: "x" } },
            { id: "c1", type: "crm.Customer", attrs: { name: "y" } },
            { id: "abc", type: "a.b.C", attrs: {} },
        ];
        g.BindSeed({ nodes, edges: [] }, { model: "svc", version: "1.0.0" });
        return CypherEngine.OverQuery(new GraphQuery(g));
    }

    public static Concepts(engine: CypherEngine, source: string): string[]
    {
        return engine.Execute(source).Rows.map((r) => (r[0] as NodeValue).Concept);
    }
}

describe("qualified node labels", () =>
{
    test("a qualified label resolves to the exact namespaced concept", () =>
    {
        const concepts = QualifiedLabelFixture.Concepts(QualifiedLabelFixture.Engine(), "MATCH (c:shop.Customer) RETURN c");
        assert.deepEqual(concepts, ["shop.Customer"]);
    });

    test("a bare label ambiguous across namespaces still throws CypherSemanticError", () =>
    {
        assert.throws(
            () => QualifiedLabelFixture.Engine().Execute("MATCH (c:Customer) RETURN c"),
            (e: unknown) => e instanceof CypherSemanticError && /shop\.Customer, crm\.Customer|crm\.Customer, shop\.Customer/.test(e.message),
        );
    });

    test("a qualified label with no matching concept throws unknown label", () =>
    {
        assert.throws(
            () => QualifiedLabelFixture.Engine().Execute("MATCH (c:shop.Nope) RETURN c"),
            (e: unknown) => e instanceof CypherSemanticError && /unknown label/.test(e.message) && /shop\.Nope/.test(e.message),
        );
    });

    test("property access a.name is unaffected", () =>
    {
        const result = QualifiedLabelFixture.Engine().Execute("MATCH (c:shop.Customer) WHERE c.name = 'x' RETURN c.name");
        assert.equal(result.Rows.length, 1);
    });

    test("a three-segment label joins fully", () =>
    {
        const concepts = QualifiedLabelFixture.Concepts(QualifiedLabelFixture.Engine(), "MATCH (c:a.b.C) RETURN c");
        assert.deepEqual(concepts, ["a.b.C"]);
    });
});
