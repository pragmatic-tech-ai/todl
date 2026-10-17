import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { GraphQuery } from "../../graph-api/graph-query-engine.js";
import { FrozenGraph } from "../../domain/graph.js";
import { Manifest } from "../../manifest/reflection/reflection.js";
import { ManifestWriter } from "../../manifest/manifest-writer.js";
import type { LogicalManifest } from "../../manifest/logical.js";
import type { ReflectedNode } from "../../manifest/reflection/reflection.js";
import { CypherEngine } from "../engine.js";
import { CypherValue, ScalarValue } from "../values.js";
import type { CypherResult } from "../result.js";
import { CypherSemanticError } from "../errors.js";

class PagingFixture
{
    private static readonly ModelName = "paging";
    private static readonly ModelVersion = "1.0.0";
    private static readonly Format = "todl-manifest/1";
    private static readonly RootConcept = "Element";
    private static readonly ServiceConcept = "Service";
    private static readonly NameField = "name";
    private static readonly StringType = "string";
    private static readonly OptionalCard = "?";
    private static readonly IdPrefix = "id";
    private static readonly NamePrefix = "s";
    private static readonly PadChar = "0";
    private static readonly PadWidth = 2;
    private static readonly UnexpectedCellMessage = "unexpected cell type in Plain()";

    // Services s00..s(count-1), inserted in REVERSE name order so an ascending result proves a sort happened.
    public static Engine(count: number): CypherEngine
    {
        const logical: LogicalManifest = {
            format: PagingFixture.Format, model: PagingFixture.ModelName, version: PagingFixture.ModelVersion,
            root: PagingFixture.RootConcept,
            concepts: {
                [PagingFixture.RootConcept]: { extends: null, fields: {}, relationships: {}, invariants: [], annotations: [] },
                [PagingFixture.ServiceConcept]: {
                    extends: PagingFixture.RootConcept,
                    fields: { [PagingFixture.NameField]: { type: PagingFixture.StringType, card: PagingFixture.OptionalCard } },
                    relationships: {},
                    invariants: [], annotations: [],
                },
            },
            classes: {}, taxonomies: {},
        };
        const g = new FrozenGraph();
        const m = Manifest.load(ManifestWriter.fromLogical(logical).toJSON());
        g.PreRegister(m);
        g.Finalize(m);
        const nodes: ReflectedNode[] = [];
        for (let i = count - 1; i >= 0; i--)
        {
            nodes.push({ id: `${PagingFixture.IdPrefix}${i}`, type: PagingFixture.ServiceConcept, attrs: { [PagingFixture.NameField]: PagingFixture.Name(i) } });
        }
        g.BindSeed({ nodes, edges: [] }, { model: PagingFixture.ModelName, version: PagingFixture.ModelVersion });
        return CypherEngine.OverQuery(new GraphQuery(g));
    }

    public static Name(i: number): string
    {
        return `${PagingFixture.NamePrefix}${String(i).padStart(PagingFixture.PadWidth, PagingFixture.PadChar)}`;
    }

    public static Names(from: number, to: number): string[]
    {
        const out: string[] = [];
        for (let i = from; i < to; i++) out.push(PagingFixture.Name(i));
        return out;
    }

    public static Col(result: CypherResult): unknown[]
    {
        return result.Rows.map((r) => PagingFixture.Plain(r[0]!));
    }

    private static Plain(v: CypherValue): unknown
    {
        if (v instanceof ScalarValue) return v.Value;
        throw new Error(`${PagingFixture.UnexpectedCellMessage}: ${v.constructor.name}`);
    }
}

class TieFixture
{
    private static readonly ModelName = "paging-tie";
    private static readonly ModelVersion = "1.0.0";
    private static readonly Format = "todl-manifest/1";
    private static readonly RootConcept = "Element";
    private static readonly ServiceConcept = "Service";
    private static readonly TierField = "tier";
    private static readonly NameField = "name";
    private static readonly StringType = "string";
    private static readonly OptionalCard = "?";
    private static readonly IdPrefix = "id";
    private static readonly NamePrefix = "s";
    private static readonly TierPrefix = "t";
    private static readonly PadChar = "0";
    private static readonly PadWidth = 2;
    private static readonly RunSize = 6;
    private static readonly UnexpectedCellMessage = "unexpected cell type in Plain()";

    // Services whose FIRST projected column (tier) repeats across rows while the SECOND column (name) is distinct.
    // The first RunSize names share tier "t0"; the rest share tier "t1". Inserted in REVERSE name order so a correct
    // ascending (tier, name) total order can only come from sorting, never from source order.
    public static Engine(count: number): CypherEngine
    {
        const logical: LogicalManifest = {
            format: TieFixture.Format, model: TieFixture.ModelName, version: TieFixture.ModelVersion,
            root: TieFixture.RootConcept,
            concepts: {
                [TieFixture.RootConcept]: { extends: null, fields: {}, relationships: {}, invariants: [], annotations: [] },
                [TieFixture.ServiceConcept]: {
                    extends: TieFixture.RootConcept,
                    fields: {
                        [TieFixture.TierField]: { type: TieFixture.StringType, card: TieFixture.OptionalCard },
                        [TieFixture.NameField]: { type: TieFixture.StringType, card: TieFixture.OptionalCard },
                    },
                    relationships: {},
                    invariants: [], annotations: [],
                },
            },
            classes: {}, taxonomies: {},
        };
        const g = new FrozenGraph();
        const m = Manifest.load(ManifestWriter.fromLogical(logical).toJSON());
        g.PreRegister(m);
        g.Finalize(m);
        const nodes: ReflectedNode[] = [];
        for (let i = count - 1; i >= 0; i--)
        {
            nodes.push({ id: `${TieFixture.IdPrefix}${i}`, type: TieFixture.ServiceConcept, attrs: { [TieFixture.TierField]: TieFixture.Tier(i), [TieFixture.NameField]: TieFixture.Name(i) } });
        }
        g.BindSeed({ nodes, edges: [] }, { model: TieFixture.ModelName, version: TieFixture.ModelVersion });
        return CypherEngine.OverQuery(new GraphQuery(g));
    }

    public static Tier(i: number): string
    {
        return `${TieFixture.TierPrefix}${i < TieFixture.RunSize ? 0 : 1}`;
    }

    public static Name(i: number): string
    {
        return `${TieFixture.NamePrefix}${String(i).padStart(TieFixture.PadWidth, TieFixture.PadChar)}`;
    }

    public static Pairs(result: CypherResult): [unknown, unknown][]
    {
        return result.Rows.map((r) => [TieFixture.Plain(r[0]!), TieFixture.Plain(r[1]!)]);
    }

    private static Plain(v: CypherValue): unknown
    {
        if (v instanceof ScalarValue) return v.Value;
        throw new Error(`${TieFixture.UnexpectedCellMessage}: ${v.constructor.name}`);
    }
}

describe("Execute paging tiebreak", () =>
{
    const TwoColumn = "MATCH (a:Service) RETURN a.tier, a.name";
    const Ordered = "MATCH (a:Service) RETURN a.tier, a.name ORDER BY a.tier, a.name";
    const e = TieFixture.Engine(10);

    test("a non-unique first column pages as a stable total order across the boundary", () =>
    {
        // The explicit (tier, name) total order is the ground truth; the implicit paging order must reproduce it.
        // RunSize=6 shares tier "t0" so a RowCap of 4 splits that run of equal first-column values across the boundary.
        const single = TieFixture.Pairs(e.Execute(Ordered));
        const pages = [0, 4, 8].map((skip) => e.Execute(TwoColumn, undefined, { Skip: skip, RowCap: 4 }));
        const paged = pages.flatMap((p) => TieFixture.Pairs(p));
        assert.deepEqual(paged, single);
        // No row skipped or duplicated: the paged sequence is exactly the ten distinct names once each.
        assert.equal(paged.length, 10);
        assert.equal(new Set(paged.map((pair) => pair[1])).size, 10);
        assert.deepEqual(pages.map((p) => p.HasMore), [true, true, false]);
    });
});

describe("Execute paging", () =>
{
    const Ordered = "MATCH (a:Service) RETURN a.name ORDER BY a.name";
    const Unordered = "MATCH (a:Service) RETURN a.name";
    const Limited = "MATCH (a:Service) RETURN a.name ORDER BY a.name LIMIT 10";
    const Counted = "MATCH (a:Service) RETURN count(a) AS c";
    const Distinct = "MATCH (a:Service) RETURN DISTINCT a.name";
    const Chained = "MATCH (a:Service) WITH a.name AS n RETURN n";
    const e = PagingFixture.Engine(10);

    test("pages by Skip/RowCap with HasMore and never Truncated", () =>
    {
        const first = e.Execute(Ordered, undefined, { Skip: 0, RowCap: 4 });
        assert.deepEqual(PagingFixture.Col(first), PagingFixture.Names(0, 4));
        assert.equal(first.HasMore, true);
        assert.equal(first.Truncated, false);
        const last = e.Execute(Ordered, undefined, { Skip: 8, RowCap: 4 });
        assert.deepEqual(PagingFixture.Col(last), PagingFixture.Names(8, 10));
        assert.equal(last.HasMore, false);
        assert.equal(last.Truncated, false);
    });

    test("exact boundary has no more", () =>
    {
        const r = e.Execute(Ordered, undefined, { Skip: 6, RowCap: 4 });
        assert.deepEqual(PagingFixture.Col(r), PagingFixture.Names(6, 10));
        assert.equal(r.HasMore, false);
        assert.equal(r.Truncated, false);
    });

    test("implicit order by first column when paging an unordered query", () =>
    {
        const r = e.Execute(Unordered, undefined, { Skip: 0, RowCap: 10 });
        assert.deepEqual(PagingFixture.Col(r), PagingFixture.Names(0, 10));
        assert.equal(r.HasMore, false);
    });

    test("unordered query without Skip keeps current behavior", () =>
    {
        const all = e.Execute(Unordered);
        assert.equal(all.Rows.length, 10);
        assert.equal(all.HasMore, false);
        assert.equal(all.Truncated, false);
        // No Skip means no implicit order: rows arrive in source (reverse-insertion) order, as before.
        assert.deepEqual(PagingFixture.Col(all), PagingFixture.Names(0, 10).reverse());
        const capped = e.Execute(Unordered, undefined, { RowCap: 2 });
        assert.equal(capped.Rows.length, 2);
        assert.equal(capped.Truncated, true);
        assert.equal(capped.HasMore, false);
    });

    test("user LIMIT bounds the total", () =>
    {
        const big = PagingFixture.Engine(50);
        const pages = [0, 4, 8].map((skip) => big.Execute(Limited, undefined, { Skip: skip, RowCap: 4 }));
        assert.deepEqual(pages.map((p) => p.Rows.length), [4, 4, 2]);
        assert.deepEqual(pages.map((p) => p.HasMore), [true, true, false]);
        assert.deepEqual(PagingFixture.Col(pages[2]!), PagingFixture.Names(8, 10));
    });

    test("skipped rows are not materialized and the result never exceeds RowCap", () =>
    {
        // Ordering (explicit or implicit) is a buffering Sort, so this guards built result rows, not source pulls.
        const big = PagingFixture.Engine(50);
        const r = big.Execute(Unordered, undefined, { Skip: 40, RowCap: 4 });
        assert.equal(r.Rows.length, 4);
        assert.deepEqual(PagingFixture.Col(r), PagingFixture.Names(40, 44));
        assert.equal(r.HasMore, true);
    });

    test("ToDto carries HasMore", () =>
    {
        const more = CypherEngine.ToDto(e.Execute(Ordered, undefined, { Skip: 0, RowCap: 4 }));
        assert.equal(more.HasMore, true);
        assert.equal(more.Truncated, false);
        const done = CypherEngine.ToDto(e.Execute(Ordered));
        assert.equal(done.HasMore, false);
    });

    test("rejects a negative or NaN Skip", () =>
    {
        assert.throws(() => e.Execute(Ordered, undefined, { Skip: -1, RowCap: 4 }), CypherSemanticError);
        assert.throws(() => e.Execute(Ordered, undefined, { Skip: Number.NaN, RowCap: 4 }), CypherSemanticError);
        assert.throws(() => e.Execute(Ordered, undefined, { Skip: 1.5, RowCap: 4 }), CypherSemanticError);
    });

    test("rejects Skip with a missing or zero RowCap", () =>
    {
        assert.throws(() => e.Execute(Ordered, undefined, { Skip: 0 }), CypherSemanticError);
        assert.throws(() => e.Execute(Ordered, undefined, { Skip: 0, RowCap: 0 }), CypherSemanticError);
    });

    test("pages over an aggregate", () =>
    {
        const r = e.Execute(Counted, undefined, { Skip: 0, RowCap: 2 });
        assert.deepEqual(PagingFixture.Col(r), [10]);
        assert.equal(r.HasMore, false);
        assert.equal(r.Truncated, false);
    });

    test("pages over DISTINCT", () =>
    {
        const first = e.Execute(Distinct, undefined, { Skip: 0, RowCap: 4 });
        assert.deepEqual(PagingFixture.Col(first), PagingFixture.Names(0, 4));
        assert.equal(first.HasMore, true);
        const last = e.Execute(Distinct, undefined, { Skip: 8, RowCap: 4 });
        assert.deepEqual(PagingFixture.Col(last), PagingFixture.Names(8, 10));
        assert.equal(last.HasMore, false);
    });

    test("pages over a WITH-chained query in ascending order", () =>
    {
        const pages = [0, 4, 8].map((skip) => e.Execute(Chained, undefined, { Skip: skip, RowCap: 4 }));
        assert.deepEqual(pages.flatMap((p) => PagingFixture.Col(p)), PagingFixture.Names(0, 10));
        assert.deepEqual(pages.map((p) => p.Rows.length), [4, 4, 2]);
        assert.deepEqual(pages.map((p) => p.HasMore), [true, true, false]);
    });
});
