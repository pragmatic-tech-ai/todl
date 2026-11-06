import { test } from "node:test";
import assert from "node:assert/strict";

import { load } from "../../parse/loader.js";
import { Repository } from "../../model/model.js";
import { all, any, comprehension, member, THIS, variable, isIn, not, neq } from "../ast.js";
import { evaluate, satisfies } from "../evaluate.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";
import { validate } from "../../validate/validate.js";

class QuantifierHarness
{
  public static Model(): Repository
  {
    const source = `namespace t {
concept component { }
concept service : component { }
aspect deployable { }
concept widget : deployable { }
concept probe { }
}`;
    const model = load([{ uri: "t.todl", text: source }]).model;
    const b = model.builder();
    b.assertInstance("t.component", "t.c1");
    b.assertInstance("t.service", "t.s1");
    b.assertInstance("t.widget", "t.w1");
    b.assertInstance("t.probe", "t.p1");
    b.commit();
    return model;
  }
}

test("all over a concept ranges over subtype instances", () =>
{
  const model = QuantifierHarness.Model();
  // t.s1 is a service (subtype of component); body holds only for c1.
  const expr = all("c", "t.component", isIn(variable("c"), member(THIS, "nothing")));
  assert.equal(satisfies(model, expr, "t.p1"), false);
  const bodyOnlyExact = comprehension("c", "t.component", not(neq(variable("c"), variable("c"))));
  const result = evaluate(model, bodyOnlyExact, "t.p1") as Set<string>;
  assert.deepEqual([...result].sort(), ["t.c1", "t.s1"]);
});

test("any over an aspect ranges over every carrier's instances", () =>
{
  const model = QuantifierHarness.Model();
  const expr = comprehension("d", "t.deployable", not(neq(variable("d"), variable("d"))));
  const result = evaluate(model, expr, "t.p1") as Set<string>;
  assert.deepEqual([...result], ["t.w1"]);
  assert.equal(satisfies(model, any("d", "t.deployable", not(neq(variable("d"), variable("d")))), "t.p1"), true);
});

test("a quantifier sees instances added after an earlier evaluation", () =>
{
  const model = QuantifierHarness.Model();
  const expr = comprehension("c", "t.component", not(neq(variable("c"), variable("c"))));
  assert.equal((evaluate(model, expr, "t.p1") as Set<string>).size, 2);
  const b = model.builder();
  b.assertInstance("t.service", "t.s2");
  b.commit();
  assert.equal((evaluate(model, expr, "t.p1") as Set<string>).size, 3);
});

test("an invariant quantifying over a concept fails on a subtype violator", () =>
{
  const model = QuantifierHarness.Model();
  // Only the exact-type instance (c1) is tagged; the subtype instance (s1) violates.
  const b = model.builder();
  b.addRelationship("t.c1", "tag", "t.p1");
  b.commit();
  model.defineInvariant("t.probe", all("c", "t.component", member(variable("c"), "tag")), "all components tagged");
  const codes = validate(model).filter((d) => d.code === DiagnosticCode.InvariantFailed);
  assert.equal(codes.length, 1);
});
