import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { check } from "../../compiler-services/api.js";
import { ModelPackageGenerator } from "../model-package.js";

class Harness
{
  public static readonly Sales = `
namespace sales {
  concept Order { total : string; label : string; }
  concept Customer { name : string; }
  datasource pg { kind = sql; connection = "crm-postgres"; host = "db.internal"; secret = pgpass; }
  model Sales : sales {
    annotate entrypoint { }
    connect pg;
    populate Order key order_id { label = "display_name"; }
    populate Customer from pg.cust_v { read-only; }
  }
}
`;

  public static Generate(): string
  {
    const { model, diagnostics } = check([{ uri: "sales.todl", text: Harness.Sales }]);
    assert.deepEqual(diagnostics, []);
    return ModelPackageGenerator.Generate(model, { name: "sales", importSpecifier: "../../../index.js" });
  }
}

test("a connector-backed model package reproduces the golden fixture byte-for-byte", () =>
{
  const golden = readFileSync(
    fileURLToPath(new URL("./fixtures/sales.package.generated.ts", import.meta.url)),
    "utf8",
  );
  assert.equal(Harness.Generate(), golden);
});

test("a connector-backed model is wired through FederatedModelDataConnector", () =>
{
  const out = Harness.Generate();
  assert.match(out, /new FederatedModelDataConnector\(SHARD_SALES_SALES_PLAN, SHARD_SALES_SALES\)/);
  assert.doesNotMatch(out, /new BundledModelDataConnector\(/);
});
