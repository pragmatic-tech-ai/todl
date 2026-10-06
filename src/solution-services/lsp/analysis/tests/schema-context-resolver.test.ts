import { test } from "node:test";
import assert from "node:assert/strict";
import { MarkedSource } from "./marked-fixture.js";
import { SchemaContextResolver } from "../schema-context-resolver.js";

test("resolves the target concept of a relationship assignment", () =>
{
    const { analysis, positions, uri } = MarkedSource.Fixture("d.todl", [
        "namespace demo {",
        "  concept person { }",
        "  concept dog { relationship owner -> person []; }",
        "  dog rex { owner = &‸ }",
        "}",
    ].join("\n"));
    const ctx = SchemaContextResolver.AssignmentContextAt(analysis, uri, positions[0]!);
    assert.equal(ctx?.Concept, "dog");
    assert.equal(ctx?.Member, "owner");
    assert.deepEqual(ctx?.TargetConcepts, ["demo.person"]);
    assert.equal(ctx?.IsRelationship, true);
});

test("returns null outside any assignment slot", () =>
{
    const { analysis, positions, uri } = MarkedSource.Fixture("d.todl",
        "namespace demo {‸\n  concept a { }\n}");
    assert.equal(SchemaContextResolver.AssignmentContextAt(analysis, uri, positions[0]!), null);
});
