import { test } from "node:test";
import assert from "node:assert/strict";

import { check } from "../../api.js";
import type { ConnectionPolicy } from "../../connectors/connection-policy.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

class Harness
{
  static Codes(body: string, policy?: ConnectionPolicy): string[]
  {
    const { diagnostics } = check(
      [{ uri: "t.todl", text: `namespace d { datasource x { ${body} } }` }], undefined, policy);
    return diagnostics.map((d) => d.code);
  }
}

test("inline coordinates are rejected when the policy forbids inline config", () =>
{
  const codes = Harness.Codes(`kind = sql; host = "h";`, { InlineAllowed: false, ProviderAllowed: false });
  assert.ok(codes.includes(DiagnosticCode.ConnectorInlineForbidden));
});

test("a model provider is rejected under the default policy", () =>
{
  const codes = Harness.Codes(`kind = sql; provider = "pkg";`);
  assert.ok(codes.includes(DiagnosticCode.ConnectorProviderForbidden));
});

test("a model provider is accepted when the policy allows it", () =>
{
  const codes = Harness.Codes(`kind = sql; provider = "pkg";`, { InlineAllowed: true, ProviderAllowed: true });
  assert.ok(!codes.includes(DiagnosticCode.ConnectorProviderForbidden));
});

test("a connection-only datasource triggers neither policy diagnostic", () =>
{
  const codes = Harness.Codes(`kind = sql; connection = "crm";`);
  assert.ok(!codes.includes(DiagnosticCode.ConnectorInlineForbidden));
  assert.ok(!codes.includes(DiagnosticCode.ConnectorProviderForbidden));
});
