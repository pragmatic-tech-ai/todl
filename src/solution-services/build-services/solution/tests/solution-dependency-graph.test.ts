import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { SolutionDependencyGraph } from "../solution-dependency-graph.js";

// deps.get(x) = the ids x depends on. A valid order lists every dependency before
// the dependents that need it.
function deps(entries: Record<string, readonly string[]>): Map<string, readonly string[]>
{
    return new Map(Object.entries(entries));
}

describe("SolutionDependencyGraph", () =>
{
    test("orders dependencies before dependents (linear chain)", () =>
    {
        const result = SolutionDependencyGraph.Order(deps({ a: ["b"], b: ["c"], c: [] }));
        assert.equal(result.Cycle, undefined);
        assert.deepEqual(result.Order, ["c", "b", "a"]);
    });

    test("orders a diamond: shared dependency first, dependent last", () =>
    {
        const result = SolutionDependencyGraph.Order(deps({ a: ["b", "c"], b: ["d"], c: ["d"], d: [] }));
        assert.equal(result.Cycle, undefined);
        assert.equal(result.Order.indexOf("d") < result.Order.indexOf("b"), true);
        assert.equal(result.Order.indexOf("d") < result.Order.indexOf("c"), true);
        assert.equal(result.Order.indexOf("b") < result.Order.indexOf("a"), true);
        assert.equal(result.Order.indexOf("c") < result.Order.indexOf("a"), true);
    });

    test("includes independent nodes", () =>
    {
        const result = SolutionDependencyGraph.Order(deps({ a: [], b: [] }));
        assert.deepEqual([...result.Order].sort(), ["a", "b"]);
    });

    test("detects a cycle and names its members", () =>
    {
        const result = SolutionDependencyGraph.Order(deps({ a: ["b"], b: ["a"] }));
        assert.notEqual(result.Cycle, undefined);
        assert.deepEqual([...result.Cycle!].sort(), ["a", "b"]);
    });

    test("Closure returns the target plus its transitive dependencies only", () =>
    {
        const graph = deps({ a: ["b"], b: ["d"], c: ["d"], d: [] });
        const closure = SolutionDependencyGraph.Closure(graph, "a");
        assert.deepEqual([...closure].sort(), ["a", "b", "d"]);
    });
});
