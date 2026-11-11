import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { checkAgainst } from "../../api.js";
import { DiagnosticCode, Severity } from "../../diagnostics/diagnostic.js";
import { compilePackage } from "../../../publish/publish.js";
import { SecurityNames } from "../../security/security-names.js";

/** Fixture sources for the system compile foundation. */
class Fx
{
  public static readonly Hr = "namespace hr { concept Employee : todl.system.Owned { Name : string; } }";
  public static readonly Plain = "namespace plain { concept Thing { Name : string; } }";
  public static readonly Redeclare = "namespace todl.system { aspect Owned { owner : string?; } }";
  public static readonly System = readFileSync(new URL("../system/system.todl", import.meta.url), "utf8");
  public static readonly SystemPrefix = SecurityNames.SystemModel + ".";
}

test("a package concept takes todl.system.Owned and compiles clean", () =>
{
  const out = compilePackage([], [{ uri: "hr.todl", text: Fx.Hr }], { id: "hr", version: "1.0.0" });
  assert.ok(out.ok, JSON.stringify(out.errors));
  assert.ok(out.package!.document.dependencies!.some((d) => d.id === SecurityNames.SystemModel && d.version === SecurityNames.SystemVersion));
  assert.ok(!out.package!.document.nodes.some((n) => n.id.startsWith(Fx.SystemPrefix)));
});

test("a package that does not use todl.system records no system dependency", () =>
{
  const out = compilePackage([], [{ uri: "plain.todl", text: Fx.Plain }], { id: "plain", version: "1.0.0" });
  assert.ok(out.ok, JSON.stringify(out.errors));
  assert.equal(out.package!.document.dependencies, undefined);
});

test("redeclaring todl.system.Owned is an error", () =>
{
  const { diagnostics } = checkAgainst([], [{ uri: "x.todl", text: Fx.Redeclare }]);
  assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.SecuritySystemNameRedeclared && d.severity === Severity.Error));
});

test("the system package itself compiles with the prelude-only foundation", () =>
{
  const out = compilePackage([], [{ uri: "system.todl", text: Fx.System }], { id: SecurityNames.SystemModel, version: SecurityNames.SystemVersion });
  assert.ok(out.ok, JSON.stringify(out.errors));
});
