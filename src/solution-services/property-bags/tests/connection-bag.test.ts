import test from 'node:test'
import assert from 'node:assert/strict'
import { ConnectionBag, ConnectionBagKind, TokenSource } from '../connection-bag.js'
import { RecordPropertyBag } from '../record-property-bag.js'

test('ConnectionBag exposes token REFERENCE fields (source/ref/env) and no raw-secret field', () =>
{
    const conn = new ConnectionBag(new RecordPropertyBag(new Map()))

    conn.DisplayName = 'GitHub npm'
    conn.RegistryType = 'npm'
    conn.TokenSource = TokenSource.Stored
    conn.TokenRef = 'secret:gh-npm'

    assert.equal(conn.DisplayName, 'GitHub npm')
    assert.equal(conn.RegistryType, 'npm')
    assert.equal(conn.TokenSource, TokenSource.Stored)
    assert.equal(conn.TokenRef, 'secret:gh-npm')

    // Reference-only: the field set names the ref/source/env-var, never a raw token/secret value.
    const fields = ConnectionBag.Fields
    assert.ok(fields.includes(ConnectionBag.TokenRefKey))
    assert.ok(fields.includes(ConnectionBag.TokenSourceKey))
    assert.ok(fields.includes(ConnectionBag.TokenEnvVarKey))
    assert.ok(!fields.some((k) => /token$|secret|password|value/i.test(k)))
})

test('TokenSource defaults to Stored and IsDefault defaults to false when unset', () =>
{
    const conn = new ConnectionBag(new RecordPropertyBag(new Map()))
    assert.equal(conn.TokenSource, TokenSource.Stored)
    assert.equal(conn.IsDefault, false)
    conn.IsDefault = true
    assert.equal(conn.IsDefault, true)
})

test('env-sourced connection carries the env-var name, not the token', () =>
{
    const conn = new ConnectionBag(new RecordPropertyBag(new Map()))
    conn.TokenSource = TokenSource.Env
    conn.TokenEnvVar = 'GH_TOKEN'
    assert.equal(conn.TokenSource, TokenSource.Env)
    assert.equal(conn.TokenEnvVar, 'GH_TOKEN')
})

test('ConnectionBagDefinition is the SettingBagDefinition for the npm-connection kind, secret-free', () =>
{
    const def = ConnectionBag.Definition()
    assert.equal(def.Id, ConnectionBagKind)
    assert.equal(ConnectionBagKind, 'npm-connection')
    const keys = def.Fields.map((f) => f.Key)
    assert.ok(keys.includes(ConnectionBag.TokenRefKey))
    assert.ok(!keys.some((k) => /token$|secret|password/i.test(k)))
})
