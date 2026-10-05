import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../api.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

function codes(text: string): DiagnosticCode[]
{
  return check([{ uri: "a.todl", text }]).diagnostics.map((d) => d.code);
}

test("two nested records with the same id under different parents is a duplicate-id error (#6)", () => {
  const { diagnostics, model } = check([{ uri: "a.todl", text: `namespace demo
  {
    concept node { label : string; }
    concept note { text : string; }
    model m : demo
    {
      node d1 { label = "D1"; note yes { text = "from d1"; } }
      node d2 { label = "D2"; note yes { text = "from d2"; } }
    }
  }` }]);
  assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.InstanceDuplicateId),
    "expected an instance.duplicate-id diagnostic");
  // The collision is still reported (no longer silent), which was the bug.
  assert.ok(model.resolve("yes") !== undefined);
});

test("distinct nested ids compile clean", () => {
  assert.ok(!codes(`namespace demo
  {
    concept node { label : string; }
    concept note { text : string; }
    model m : demo
    {
      node d1 { label = "D1"; note n1 { text = "from d1"; } }
      node d2 { label = "D2"; note n2 { text = "from d2"; } }
    }
  }`).includes(DiagnosticCode.InstanceDuplicateId));
});
