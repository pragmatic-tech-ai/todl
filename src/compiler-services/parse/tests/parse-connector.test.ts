import { test } from "node:test";
import assert from "node:assert/strict";

import { parse } from "../parser.js";
import { DeclKind, type ConnectorDecl, type ModelDecl } from "../ast.js";

class Harness
{
    static decls(text: string)
    {
        const result = parse(text);
        assert.deepEqual(result.diagnostics, [], "unexpected parse diagnostics");
        return result.namespace.declarations;
    }
}

test("datasource declaration parses named and inline forms", () =>
{
    const src = `namespace n {
        datasource pg { kind = sql; connection = "crm-postgres"; }
        datasource wh { host = "db.example.com"; database = "wh"; secret = warehouse-ro; }
    }`;
    const cs = Harness.decls(src).filter((d) => d.kind === DeclKind.Connector) as ConnectorDecl[];
    assert.equal(cs.length, 2);
    assert.equal(cs[0]!.name, "pg");
    assert.deepEqual(cs[0]!.assignments.map((a) => [a.name, a.value]), [["kind", "sql"], ["connection", "crm-postgres"]]);
    assert.equal(cs[1]!.name, "wh");
    assert.deepEqual(cs[1]!.assignments.map((a) => [a.name, a.value]),
        [["host", "db.example.com"], ["database", "wh"], ["secret", "warehouse-ro"]]);
});

test("model body parses connect and populate statements", () =>
{
    const src = `namespace n { model m : mm {
        connect pg;
        populate Customer;
        populate Order from pg key order_id { label = "display_name"; placed-on = "created_at"; }
        populate Shipment from warehouse.shipment_v { read-only; }
    } }`;
    const m = Harness.decls(src).find((d) => d.kind === DeclKind.Model) as ModelDecl;
    assert.deepEqual(m.connects.map((c) => c.connector), ["pg"]);
    assert.equal(m.populations.length, 3);
    const [c, o, s] = m.populations as [typeof m.populations[0], typeof m.populations[0], typeof m.populations[0]];
    assert.deepEqual([c.concept, c.connector, c.source, c.idKey, c.overrides, c.readOnly], ["Customer", null, null, null, [], false]);
    assert.deepEqual([o.concept, o.connector, o.source, o.idKey, o.readOnly], ["Order", "pg", null, "order_id", false]);
    assert.deepEqual(o.overrides.map((x) => [x.member, x.field]), [["label", "display_name"], ["placed-on", "created_at"]]);
    assert.deepEqual([s.concept, s.connector, s.source, s.readOnly, s.overrides.length], ["Shipment", "warehouse", "shipment_v", true, 0]);
    assert.equal(m.instances.length, 0);
});
