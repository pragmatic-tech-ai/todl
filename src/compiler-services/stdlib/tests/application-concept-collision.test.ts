import { test } from "node:test";
import assert from "node:assert/strict";

import { check } from "../../api.js";
import { MetaKind } from "../../model/kinds.js";
import { Severity } from "../../diagnostics/diagnostic.js";

// Regression: the prelude's application-root marker must NOT squat on the common
// domain word `application` (the C4 Application / ArchiMate application component
// is a legitimate concept name). A meta-model that declares `concept application`
// and frames it in a viewpoint must resolve cleanly — no "provided by the default
// library", no "not a concept", no "annotation may only extend an annotation"
// cascade. This is why the prelude marker is named `entrypoint`, not `application`.
const SRC = `namespace mm {
  concept application {
    label          : string?;
    app_components : identifier[];
  }
  viewpoint V : frames application
}`;

test("a meta-model may declare `concept application` without colliding with the prelude", () => {
  const { model, diagnostics } = check([{ uri: "mm.todl", text: SRC }]);
  assert.deepEqual(
    diagnostics.filter((d) => d.severity === Severity.Error),
    [],
    "no errors: `application` is the model's own concept, not a prelude marker",
  );
  const node = model.resolve("mm.application") ?? model.resolve("application");
  assert.ok(node, "`application` resolves");
  assert.equal(node.metaKind, MetaKind.Concept, "`application` resolves as a concept");
});
