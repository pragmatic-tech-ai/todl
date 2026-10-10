import { test } from "node:test";
import assert from "node:assert/strict";

import { DisjointSet } from "../union-find.js";

test("unioned elements share a representative; transitive closure holds", () =>
{
    const ds = new DisjointSet<string>();
    for (const x of ["a", "b", "c", "d"]) ds.Add(x);
    ds.Union("a", "b");
    ds.Union("b", "c");   // a-b-c transitively one cluster; d alone
    assert.equal(ds.Find("a"), ds.Find("c"));
    assert.notEqual(ds.Find("a"), ds.Find("d"));
});

test("Clusters groups transitively and is order-independent", () =>
{
    const ds = new DisjointSet<string>();
    for (const x of ["z", "a", "m"]) ds.Add(x);
    ds.Union("m", "z");
    const clusters = ds.Clusters().map((c) => [...c].sort());
    clusters.sort((p, q) => (p[0]! < q[0]! ? -1 : 1));
    assert.deepEqual(clusters, [["a"], ["m", "z"]]);

    const reversed = new DisjointSet<string>();
    for (const x of ["m", "a", "z"]) reversed.Add(x);
    reversed.Union("z", "m");
    const other = reversed.Clusters().map((c) => [...c].sort());
    other.sort((p, q) => (p[0]! < q[0]! ? -1 : 1));
    assert.deepEqual(other, clusters);
});

test("Union on an un-added element adds it", () =>
{
    const ds = new DisjointSet<string>();
    ds.Union("x", "y");
    assert.equal(ds.Find("x"), ds.Find("y"));
});

test("an element added only via Union still appears in Clusters", () =>
{
    const ds = new DisjointSet<string>();
    ds.Union("x", "y");
    const clusters = ds.Clusters().map((c) => [...c].sort());
    assert.deepEqual(clusters, [["x", "y"]]);
});
