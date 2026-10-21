import { test } from "node:test";
import assert from "node:assert/strict";
import { WriteAtomicity, WriteConcurrency, WriteFailureKind } from "../connector-plan.js";
import type { WriteResult } from "../connector-plan.js";
import { WriteCapability } from "../write-capability.js";
import { RollbackSignal } from "../rollback-signal.js";

test("WriteConcurrency carries the authored wire values", () =>
{
    assert.equal(WriteConcurrency.LastWriteWins, "last-write-wins");
    assert.equal(WriteConcurrency.Optimistic, "optimistic");
});

test("WriteAtomicity carries the authored wire values", () =>
{
    assert.equal(WriteAtomicity.Sequential, "sequential");
    assert.equal(WriteAtomicity.Transactional, "transactional");
});

test("WriteFailureKind carries the authored wire values", () =>
{
    assert.equal(WriteFailureKind.Conflict, "conflict");
    assert.equal(WriteFailureKind.Error, "error");
    assert.equal(WriteFailureKind.Unsupported, "unsupported");
});

test("WriteCapability defaults absent capabilities to false", () =>
{
    assert.equal(WriteCapability.CanTransact({}), false);
    assert.equal(WriteCapability.CanVersion({}), false);
});

test("WriteCapability reports a declared capability", () =>
{
    assert.equal(WriteCapability.CanTransact({ CanTransact: true }), true);
    assert.equal(WriteCapability.CanVersion({ CanVersion: true }), true);
});

test("RollbackSignal round-trips its carried result and is an Error", () =>
{
    const result: WriteResult =
    {
        Applied: 2,
        Failures: [{ Key: "k-1", Kind: WriteFailureKind.Conflict, Reason: "version mismatch" }],
    };
    const signal = new RollbackSignal(result);
    assert.ok(signal instanceof Error);
    assert.equal(signal.Result, result);
    assert.equal(signal.Result.Applied, 2);
    assert.equal(signal.Result.Failures[0]!.Kind, WriteFailureKind.Conflict);
});
