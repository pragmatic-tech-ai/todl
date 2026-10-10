import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { tokenize, TokenKind } from "../lexer.js";
import { parsePredicate } from "../predicate-parser.js";
import { parse } from "../parser.js";
import { DeclKind } from "../ast.js";
import { Repository } from "../../model/model.js";
import { satisfies } from "../../predicate/evaluate.js";
import { ExprKind, UnaryOp } from "../../predicate/ast.js";

function predicate(source: string)
{
  const tokens = tokenize(source).filter((token) => token.kind !== TokenKind.EOF);
  return parsePredicate(tokens);
}

function serviceTask(assignee: string | null): Repository
{
  const model = new Repository();
  const builder = model.builder();
  builder.assertInstance("TaskType", "service");
  builder.assertInstance("task", "t1").addRelationship("t1", "type", "service");
  if (assignee !== null) builder.setField("t1", "assignee", assignee);
  builder.commit();
  return model;
}

test("assignee invariant holds for a service task with no assignee", () => {
  const expr = predicate("(this.type == service || this.type == script) implies this.assignee == none");
  assert.equal(satisfies(serviceTask(null), expr, "t1"), true);
});

test("assignee invariant fails for a service task that has an assignee", () => {
  const expr = predicate("(this.type == service || this.type == script) implies this.assignee == none");
  assert.equal(satisfies(serviceTask("sales-manager"), expr, "t1"), false);
});

test("start-event invariant desugars .empty and holds with no incoming flows", () => {
  const expr = predicate("this.eventType == start implies this.incoming.empty");
  const model = new Repository();
  model
    .builder()
    .assertInstance("EventType", "start")
    .assertInstance("event", "e1")
    .addRelationship("e1", "eventType", "start")
    .commit();

  assert.equal(satisfies(model, expr, "e1"), true);
});

test("start-event invariant fails when a start event has an incoming flow", () => {
  const expr = predicate("this.eventType == start implies this.incoming.empty");
  const model = new Repository();
  model
    .builder()
    .assertInstance("EventType", "start")
    .assertInstance("SequenceFlow", "f1")
    .assertInstance("event", "e1")
    .addRelationship("e1", "eventType", "start")
    .addRelationship("e1", "incoming", "f1")
    .commit();

  assert.equal(satisfies(model, expr, "e1"), false);
});

test("parses the predicate captured from the concept fixture and evaluates it", () => {
  const { namespace } = parse(
    readFileSync(fileURLToPath(new URL("./fixtures/concepts.todl", import.meta.url)), "utf8"),
  );
  const task = namespace.declarations.find(
    (declaration) => declaration.kind === DeclKind.Concept && declaration.name === "Task",
  );
  assert.ok(task && task.kind === DeclKind.Concept);

  const captured = task.kind === DeclKind.Concept ? task.invariants[1]?.predicate : null;
  assert.ok(captured);

  const expr = parsePredicate(captured);
  assert.equal(satisfies(serviceTask(null), expr, "t1"), true);
  assert.equal(satisfies(serviceTask("bob"), expr, "t1"), false);
});

test("word operators 'and' / 'or' produce the same AST as '&&' / '||'", () => {
  assert.deepEqual(predicate("a and b"), predicate("a && b"));
  assert.deepEqual(predicate("a or b"), predicate("a || b"));
});

test("'not a' parses to a unary Not over the name", () => {
  const expr = predicate("not a");
  assert.equal(expr.kind, ExprKind.Unary);
  assert.equal(expr.op, UnaryOp.Not);
  assert.deepEqual(expr.operand, predicate("a"));
});

test("word operators keep precedence: 'a and b or c' is Or(And(a,b), c)", () => {
  assert.deepEqual(predicate("a and b or c"), predicate("(a && b) || c"));
  assert.deepEqual(predicate("a or b and c"), predicate("a || (b && c)"));
});

test("'not' binds tightly and negates a parenthesised comparison", () => {
  assert.deepEqual(predicate("not a and b"), predicate("(not a) && b"));
  assert.equal(satisfies(serviceTask(null), predicate("not (this.assignee != none)"), "t1"), true);
  assert.equal(satisfies(serviceTask("x"), predicate("not (this.assignee != none)"), "t1"), false);
});

test("'not a == b' is '(not a) == b'", () => {
  assert.deepEqual(predicate("not a == b"), predicate("(not a) == b"));
});

test("'not not x' is a double Not over the name", () => {
  const expr = predicate("not not x");
  assert.equal(expr.kind, ExprKind.Unary);
  assert.equal(expr.op, UnaryOp.Not);
  assert.equal(expr.operand.kind, ExprKind.Unary);
  assert.equal(expr.operand.op, UnaryOp.Not);
  assert.deepEqual(expr.operand.operand, predicate("x"));
});
