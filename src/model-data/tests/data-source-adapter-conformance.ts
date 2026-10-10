import { test } from "node:test";
import assert from "node:assert/strict";
import type { IDataSourceAdapter } from "../data-source-adapter.js";

/**
 * Contract every data-source adapter must satisfy. The adapter returned by
 * `make` must hold source "Customer" seeded with a record { id: "c1", label: "Acme" }.
 */
export function describeDataSourceAdapter(name: string, make: () => IDataSourceAdapter): void
{
  test(`${name}: Query returns only the requested fields per record`, async () => {
    const rows = await make().Query({ Source: "Customer", Fields: ["id", "label"] });
    assert.equal(rows.length, 1);
    assert.deepEqual(Object.keys(rows[0]!).sort(), ["id", "label"]);
    assert.equal(rows[0]!.id, "c1");
  });

  test(`${name}: an unknown source yields no records`, async () => {
    const rows = await make().Query({ Source: "Nope", Fields: ["id"] });
    assert.deepEqual(rows, []);
  });

  test(`${name}: projecting a subset of fields drops the others`, async () => {
    const rows = await make().Query({ Source: "Customer", Fields: ["id"] });
    assert.deepEqual(rows[0], { id: "c1" });
    assert.equal("label" in rows[0]!, false);
  });
}
