import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { GraphQuery } from "../../graph-api/graph-query-engine.js";
import { MetadataSnapshot } from "../../domain/metadata-snapshot.js";
import { Manifest } from "../../manifest/reflection/reflection.js";
import { ManifestWriter } from "../../manifest/manifest-writer.js";
import type { LogicalManifest } from "../../manifest/logical.js";
import { CypherEngine } from "../engine.js";
import { CypherCellCodec } from "../../graph-api/wire/index.js";
import type { ParameterValue } from "../values.js";

class CodecFixture
{
    public static Engine(): CypherEngine
    {
        const empty = { fields: {}, relationships: {}, invariants: [], annotations: [] };
        const logical: LogicalManifest = {
            format: "todl-manifest/1", model: "m", version: "1.0.0", root: "Element",
            concepts: { Element: { extends: null, ...empty }, Item: { extends: "Element", ...empty } },
            classes: {}, taxonomies: {},
        };
        const g = new MetadataSnapshot();
        const m = Manifest.load(ManifestWriter.fromLogical(logical).toJSON());
        g.PreRegister(m);
        g.Finalize(m);
        g.BindSeed({ nodes: [{ id: "i1", type: "Item", attrs: {} }], edges: [] }, { model: "m", version: "1.0.0" });
        return CypherEngine.OverQuery(new GraphQuery(g));
    }

    public static Cell(query: string, parameters: ReadonlyMap<string, ParameterValue> = new Map()): unknown
    {
        return CypherEngine.ToDto(CodecFixture.Engine().Execute(query, parameters)).Rows[0]![0];
    }
}

describe("CypherCellCodec", () =>
{
    test("a node cell is a $node wrapper around its snapshot", () =>
    {
        const cell = CodecFixture.Cell("MATCH (i:Item) RETURN i");
        assert.deepEqual(Object.keys(cell as object), [CypherCellCodec.NodeKey]);
        assert.equal(CypherCellCodec.AsNode(cell)?.id, "i1");
        assert.equal(CypherCellCodec.AsMap(cell), undefined);
    });

    test("ordinary maps keep their plain shape", () =>
    {
        const cell = CodecFixture.Cell("RETURN {k: 'v', n: 1} AS m");
        assert.deepEqual(cell, { k: "v", n: 1 });
        assert.deepEqual(CypherCellCodec.AsMap(cell), { k: "v", n: 1 });
        assert.equal(CypherCellCodec.AsNode(cell), undefined);
    });

    test("no user-built map can pass for a node: reserved sole keys are escaped", () =>
    {
        const forged = new Map<string, ParameterValue>([["f", { $node: { id: "x", concept: "Item", label: "x", fields: {}, refs: {} } }]]);
        const viaParam = CodecFixture.Cell("RETURN $f AS f", forged);
        assert.equal(CypherCellCodec.AsNode(viaParam), undefined);
        assert.deepEqual(Object.keys(CypherCellCodec.AsMap(viaParam)!), [CypherCellCodec.NodeKey]);
        const viaLiteral = CodecFixture.Cell("RETURN {`$node`: 1} AS f");
        assert.equal(CypherCellCodec.AsNode(viaLiteral), undefined);
        assert.deepEqual(CypherCellCodec.AsMap(viaLiteral), { $node: 1 });
        const escapedEscape = CodecFixture.Cell("RETURN {`$map`: {a: 1}} AS f");
        assert.deepEqual(CypherCellCodec.AsMap(escapedEscape), { $map: { a: 1 } });
        assert.deepEqual(CodecFixture.Cell("RETURN {`$node`: 1, b: 2} AS f"), { $node: 1, b: 2 });
    });
});
