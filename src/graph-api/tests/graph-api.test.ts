import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../compiler-services/api.js";
import { toJSON } from "../../compiler-services/emit/json.js";
import { GraphApi } from "../index.js";

const SRC = `namespace shop {
  concept Product { label : string?; price : number?; }
  concept Order { label : string?; items : Product[]; }
  model M : shop {
    Product widget { label = "Widget"; price = 9; }
    Order o1 { label = "Order 1"; items = [widget]; }
  }
}`;

function api(): GraphApi
{
  const { model, diagnostics } = check([{ uri: "shop.todl", text: SRC }]);
  assert.deepEqual(diagnostics.map((d) => d.message), [], "sample compiles clean");
  return GraphApi.FromDocument(toJSON(model));
}

describe("GraphApi", () =>
{
  test("Concepts lists the declared concepts by label", () =>
  {
    const labels = api().Concepts().map((c) => c.label);
    assert.ok(labels.includes("Product") && labels.includes("Order"), labels.join(","));
  });

  test("InstancesOf returns instances of a concept", () =>
  {
    const g = api();
    const product = g.Concepts().find((c) => c.label === "Product")!;
    const instances = g.InstancesOf(product.id);
    assert.equal(instances.length, 1);
    assert.equal(instances[0]!.label, "Widget");
  });

  test("Entity projects fields and Refs follows a member", () =>
  {
    const g = api();
    const product = g.Concepts().find((c) => c.label === "Product")!;
    const order = g.Concepts().find((c) => c.label === "Order")!;
    const widget = g.InstancesOf(product.id)[0]!;
    const o1 = g.InstancesOf(order.id)[0]!;

    const el = g.Entity(widget.id)!;
    assert.equal(el.fields.label, "Widget");
    assert.equal(el.fields.price, "9"); // TODL scalars serialize as strings

    const items = g.Refs(o1.id, "items");
    assert.equal(items.length, 1);
    assert.equal(items[0]!.id, widget.id);
  });

  test("Search matches by label, unknown ids return undefined/empty", () =>
  {
    const g = api();
    assert.ok(g.Search("widg").some((s) => s.label === "Widget"));
    assert.equal(g.Entity("does-not-exist"), undefined);
    assert.deepEqual(g.Refs("does-not-exist", "items"), []);
  });
});
