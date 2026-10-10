import { test } from "node:test";
import assert from "node:assert/strict";
import { lex } from "../../parse/lexer.js";
import { parsePolicyPredicate } from "../policy-predicate-parser.js";
import { PolicyPredicateCodec } from "../policy-predicate-codec.js";
import { PolicyNodeKind, PolicyRefRoot, PolicyCompareOp, PolicyBoolOp, PolicyPredicateMembers } from "../policy-predicate.js";

function predicate(text: string)
{
    const result = lex(text, "policy.test");
    if (result.diagnostics.length > 0)
    {
        throw new Error("lex error: " + result.diagnostics[0]!.message);
    }
    return parsePolicyPredicate(result.tokens);
}

test("parses principal/entity member comparison", () =>
{
    const p = predicate("principal.region == entity.region");
    assert.equal(p.kind, PolicyNodeKind.Compare);
    const compare = p as Extract<typeof p, { kind: PolicyNodeKind.Compare }>;
    assert.equal(compare.op, PolicyCompareOp.Eq);
    assert.deepEqual(compare.left, { kind: PolicyNodeKind.Ref, root: PolicyRefRoot.Principal, member: "region" });
    assert.deepEqual(compare.right, { kind: PolicyNodeKind.Ref, root: PolicyRefRoot.Entity, member: "region" });
});

test("parses literal comparison and membership and boolean/not", () =>
{
    const p = predicate(`entity.classification == "restricted" and not (principal.groups has "cleared")`);
    assert.equal(p.kind, PolicyNodeKind.Bool);
    const b = p as Extract<typeof p, { kind: PolicyNodeKind.Bool }>;
    assert.equal(b.op, PolicyBoolOp.And);
    assert.equal(b.left.kind, PolicyNodeKind.Compare);
    assert.equal(b.right.kind, PolicyNodeKind.Not);
});

test("parses number/boolean literals and 'in' membership", () =>
{
    const p = predicate(`entity.level != 3 or "a" in principal.groups or entity.open == true`);
    assert.equal(p.kind, PolicyNodeKind.Bool);
    assert.deepEqual(PolicyPredicateCodec.FromJson(PolicyPredicateCodec.ToJson(p)), p);
});

test("round-trips through the codec", () =>
{
    const p = predicate(`principal.region == entity.region or principal.groups has "admin"`);
    assert.deepEqual(PolicyPredicateCodec.FromJson(PolicyPredicateCodec.ToJson(p)), p);
});

test("EntityMembers collects entity refs only", () =>
{
    const p = predicate(`entity.classification == "restricted" and principal.region == entity.region`);
    assert.deepEqual([...PolicyPredicateMembers.EntityMembers(p)].sort(), ["classification", "region", ].sort());
});

test("codec rejects unrecognized shapes", () =>
{
    assert.throws(() => PolicyPredicateCodec.FromJson(`{"kind":99}`));
    assert.throws(() => PolicyPredicateCodec.FromJson(`"x"`));
});

test("rejects malformed predicates", () =>
{
    assert.throws(() => predicate("principal.region =="));
    assert.throws(() => predicate("principal"));
    assert.throws(() => predicate(`"x"`));
    assert.throws(() => predicate("principal.region @@ entity.region"));
});
