import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../api.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

const META = `namespace t {
  concept report { label : string; invariant "Every report is read by someone."; }
  concept unit { label : string; }
}`;

test("variants land on the instance node, in source order, with no diagnostics", () => {
  const { model, diagnostics } = check([
    { uri: "meta.todl", text: META },
    { uri: "m.todl", text: `namespace m { import t; model clinic : t {
      report monthly {
        label = "Monthly";
        variant "Nobody reads it: it is made by habit.";
        variant "It has no owner.";
      }
      unit u { label = "U";
        report nested { label = "N"; variant "Nested defect."; }
      }
    } }` },
  ]);
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(model.variantsOf("m.monthly"), ["Nobody reads it: it is made by habit.", "It has no owner."]);
  assert.deepEqual(model.variantsOf("m.nested"), ["Nested defect."]);
  assert.deepEqual(model.variantsOf("m.u"), []);
  assert.deepEqual(model.variantsOf("nope"), []);
});

test("a variant on a class is variant.invalid-target and is not recorded", () => {
  const { model, diagnostics } = check([
    { uri: "meta.todl", text: META },
    { uri: "c.todl", text: `namespace c { import t;
      class report standard { label = "Standard"; variant "x"; }
    }` },
  ]);
  const codes = diagnostics.map((d) => d.code);
  assert.deepEqual(codes, [DiagnosticCode.VariantInvalidTarget]);
  assert.deepEqual(model.variantsOf("c.standard"), []);
});
