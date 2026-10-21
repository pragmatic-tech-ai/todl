import { test } from "node:test";
import assert from "node:assert/strict";
import { ConnectionFailureKind, ConnectionRetryBackoff } from "../connection-reconnect.js";
import type { ConnectionRetryPolicy } from "../connection-reconnect.js";

class ConnectionReconnectFixture
{
    public static readonly Policy: ConnectionRetryPolicy = { InitialDelayMs: 200, Factor: 2, MaxDelayMs: 2000, MaxAttempts: 3 };
}

test("backoff is bounded by MaxDelayMs and uses injected random", () =>
{
    const full = new ConnectionRetryBackoff(ConnectionReconnectFixture.Policy, () => 1);
    assert.equal(full.Next(1), 200);
    assert.equal(full.Next(2), 400);
    assert.equal(full.Next(3), 800);
    assert.equal(full.Next(20), 2000);
    const zero = new ConnectionRetryBackoff(ConnectionReconnectFixture.Policy, () => 0);
    assert.equal(zero.Next(1), 0);
    assert.equal(zero.Next(20), 0);
    const half = new ConnectionRetryBackoff(ConnectionReconnectFixture.Policy, () => 0.5);
    assert.equal(half.Next(1), 100);
});

test("ConnectionFailureKind values are stable", () =>
{
    assert.equal(ConnectionFailureKind.Transient, "transient");
    assert.equal(ConnectionFailureKind.Auth, "auth");
    assert.equal(ConnectionFailureKind.Permanent, "permanent");
});
