import { test } from "node:test";
import assert from "node:assert/strict";

import { load } from "../loader.js";
import { MetaKind } from "../../model/kinds.js";
import { Builder } from "../../model/builder.js";
import { DiagnosticCode } from "../../validate/validate.js";

class Harness
{
    static compile(body: string, extra: string = "")
    {
        return load([{
            uri: "t.todl",
            text: `namespace d {
                concept Order { total : string; label : string; }
                concept Customer { name : string; }
                datasource pg { kind = sql; connection = "crm-postgres"; host = "h"; secret = s1; }
                ${extra}
                model m : d { ${body} }
            }`,
        }]);
    }

    static population(model: ReturnType<typeof load>["model"], concept: string)
    {
        const attrs = model.resolve(`d.m@populate:d.${concept}`)?.attrs;
        assert.ok(attrs, "population node missing");
        return attrs;
    }
}

test("convention expansion yields a total field map with overrides applied", () =>
{
    const { model, diagnostics } = Harness.compile(
        `connect pg; populate Order key order_id { label = "display_name"; }`);
    assert.deepEqual(diagnostics, []);
    const attrs = Harness.population(model, "Order");
    assert.deepEqual(JSON.parse(String(attrs.get(Builder.BindingFieldMapAttr))),
        { id: "order_id", total: "total", label: "display_name" });
    assert.equal(attrs.get(Builder.BindingIdKeyAttr), "order_id");
    assert.equal(attrs.get(Builder.BindingSourceAttr), "Order");
    assert.equal(attrs.get(Builder.BindingWritableAttr), true);
});

test("a binding declaring version+concurrency+atomicity lowers to the right ConnectorBinding", () =>
{
    const { model, diagnostics } = Harness.compile(
        `connect pg; populate Order key order_id { version total; concurrency optimistic; atomicity transactional; label = "display_name"; }`);
    assert.deepEqual(diagnostics, []);
    const attrs = Harness.population(model, "Order");
    assert.equal(attrs.get(Builder.BindingVersionAttr), "total");
    assert.equal(attrs.get(Builder.BindingConcurrencyAttr), "optimistic");
    assert.equal(attrs.get(Builder.BindingAtomicityAttr), "transactional");
    // The write-mode attributes coexist with the ordinary field-map overrides.
    assert.deepEqual(JSON.parse(String(attrs.get(Builder.BindingFieldMapAttr))),
        { id: "order_id", total: "total", label: "display_name" });
});

test("omitting the write-mode attributes stages no version/concurrency/atomicity attrs", () =>
{
    const { model, diagnostics } = Harness.compile(`connect pg; populate Order;`);
    assert.deepEqual(diagnostics, []);
    const attrs = Harness.population(model, "Order");
    assert.equal(attrs.get(Builder.BindingVersionAttr), undefined);
    assert.equal(attrs.get(Builder.BindingConcurrencyAttr), undefined);
    assert.equal(attrs.get(Builder.BindingAtomicityAttr), undefined);
});

test("a version naming a non-member emits connector.unknown-field", () =>
{
    const { diagnostics } = Harness.compile(
        `connect pg; populate Order { concurrency optimistic; version nope; }`);
    assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.ConnectorUnknownField));
});

test("an unrecognized concurrency value is a parse error", () =>
{
    const { diagnostics } = Harness.compile(`connect pg; populate Order { concurrency bogus; }`);
    assert.ok(diagnostics.length > 0);
});

test("an override on a non-member emits connector.unknown-field", () =>
{
    const { diagnostics } = Harness.compile(`connect pg; populate Order { nope = "x"; }`);
    assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.ConnectorUnknownField));
});

test("populate of an unknown concept emits connector.unknown-concept", () =>
{
    const { diagnostics } = Harness.compile(`connect pg; populate Ghost;`);
    assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.ConnectorUnknownConcept));
});

test("duplicate populate for one concept emits connector.duplicate-populate, first wins", () =>
{
    const { model, diagnostics } = Harness.compile(
        `connect pg; populate Order key a; populate Order key b;`);
    assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.ConnectorDuplicatePopulate));
    assert.equal(Harness.population(model, "Order").get(Builder.BindingIdKeyAttr), "a");
});

test("populate with neither from nor connect emits connector.unresolved-connector", () =>
{
    const { diagnostics } = Harness.compile(`populate Order;`);
    assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.ConnectorUnresolvedConnector));
});

test("connector and population nodes land in the model with expected attrs", () =>
{
    const { model, diagnostics } = Harness.compile(
        `populate Customer from pg.cust_v { read-only; }`);
    assert.deepEqual(diagnostics, []);
    const connectorIds = model.nodesOfMetaKind(MetaKind.Connector);
    assert.equal(connectorIds.length, 1);
    const c = model.resolve(connectorIds[0]!)!.attrs;
    assert.equal(c.get(Builder.ConnectorKindAttr), "sql");
    assert.equal(c.get(Builder.ConnectorConnectionAttr), "crm-postgres");
    assert.equal(c.get(Builder.ConnectorSecretAttr), "s1");
    assert.deepEqual(JSON.parse(String(c.get(Builder.ConnectorConfigAttr))), { host: "h" });
    const p = Harness.population(model, "Customer");
    assert.equal(p.get(Builder.BindingConnectorAttr), connectorIds[0]);
    assert.equal(p.get(Builder.BindingSourceAttr), "cust_v");
    assert.equal(p.get(Builder.BindingWritableAttr), false);
    assert.equal(p.get(Builder.BindingConceptAttr), "d.Customer");
    assert.deepEqual(JSON.parse(String(p.get(Builder.BindingFieldMapAttr))), { id: "id", name: "name" });
});

test("binding carries its model id; two models populating one concept keep distinct nodes", () =>
{
    const { model, diagnostics } = Harness.compile(
        `connect pg; populate Order;`, `model m2 : d { connect pg; populate Order; }`);
    assert.deepEqual(diagnostics, []);
    const ids = model.nodesOfMetaKind(MetaKind.Population);
    assert.equal(ids.length, 2);
    assert.equal(new Set(ids).size, 2);
    const models = ids.map((i) => String(model.resolve(i)!.attrs.get(Builder.BindingModelAttr))).sort();
    assert.deepEqual(models, ["d.m", "d.m2"]);
});

test("id member always equals idKey; key clause beats an id override", () =>
{
    const { model } = Harness.compile(`connect pg; populate Order key order_id { id = "other"; }`);
    const a = Harness.population(model, "Order");
    const map = JSON.parse(String(a.get(Builder.BindingFieldMapAttr)));
    assert.equal(map[Builder.IdMember], a.get(Builder.BindingIdKeyAttr));
    assert.equal(map[Builder.IdMember], "order_id");
});

test("connector from another namespace is unresolved", () =>
{
    const { diagnostics } = load([
        { uri: "o.todl", text: `namespace o { datasource x { kind = sql; } }` },
        { uri: "d.todl", text: `namespace d { concept Order { total : string; } model m : d { populate Order from x; } }` },
    ]);
    assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.ConnectorUnresolvedConnector));
});

test("datasource with no kind emits connector.unknown-kind", () =>
{
    const { diagnostics } = load([{ uri: "k.todl", text: `namespace k { datasource pg { connection = "x"; } }` }]);
    assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.ConnectorUnknownKind));
});

test("datasource with an unrecognized kind emits connector.unknown-kind", () =>
{
    const { diagnostics } = load([{ uri: "k.todl", text: `namespace k { datasource pg { kind = bogus; } }` }]);
    const found = diagnostics.filter((d) => d.code === DiagnosticCode.ConnectorUnknownKind);
    assert.equal(found.length, 1);
    assert.match(found[0]!.message, /pg.*bogus/);
});

test("datasource with a valid kind emits no connector.unknown-kind", () =>
{
    const { diagnostics } = load([{ uri: "k.todl", text: `namespace k { datasource pg { kind = sql; } }` }]);
    assert.ok(!diagnostics.some((d) => d.code === DiagnosticCode.ConnectorUnknownKind));
});
