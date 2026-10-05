import { test } from "node:test";
import assert from "node:assert/strict";
import { recaseSource, toPascal, toCamel, toLowerCamel } from "../recase.js";

test("casing helpers split on -, _, and case boundaries (idempotent)", () => {
  assert.equal(toPascal("app-component"), "AppComponent");
  assert.equal(toPascal("AppComponent"), "AppComponent");
  assert.equal(toCamel("hosted-by"), "hostedBy");
  assert.equal(toCamel("HostedBy"), "hostedBy");
  assert.equal(toLowerCamel("meta-models"), "metaModels");
});

test("recases a concept declaration, supertype, and member/type divergence", () => {
  const out = recaseSource(`concept app-component : component { hosted-by : technology; depends-on : depends-on; }`);
  assert.equal(out, `concept AppComponent : Component { hostedBy : Technology; dependsOn : DependsOn; }`);
});

test("leaves built-in primitives lowercase, recases user primitives", () => {
  assert.equal(recaseSource(`primitive resource-key : string { }`), `primitive ResourceKey : string { }`);
  assert.equal(recaseSource(`label : string?;`), `label : string?;`);
  assert.equal(recaseSource(`weight : number;`), `weight : number;`);
});

test("recases taxonomy, represents, and terms; keeps namespaces lowercase", () => {
  const out = recaseSource(`namespace adl.meta-models.bpmn { taxonomy task-type : represents task { term user { label = "User"; } } }`);
  assert.equal(out, `namespace adl.metaModels.bpmn { taxonomy TaskType : represents Task { term User { label = "User"; } } }`);
});

test("recases annotation decl + application; identifier-valued string follows referent", () => {
  assert.equal(recaseSource(`annotation my-badge { path : string; }`), `annotation MyBadge { path : string; }`);
  assert.equal(recaseSource(`annotate my-badge { path = "x"; }`), `annotate MyBadge { path = "x"; }`);
  assert.equal(recaseSource(`annotate instance { concept = "app-component"; }`), `annotate Instance { concept = "AppComponent"; }`);
});

test("relationship name is a member (camel); target is a type (Pascal)", () => {
  assert.equal(recaseSource(`relationship lives-in -> sequence-flow[];`), `relationship livesIn -> SequenceFlow[];`);
});

test("recases instance declarations: type ref Pascal, instance id camel", () => {
  assert.equal(recaseSource(`event-trigger message { }`), `EventTrigger message { }`);
  assert.equal(
    recaseSource(`event order-placed { label = "Order Placed"; outgoing = [order-to-validate]; }`),
    `Event orderPlaced { label = "Order Placed"; outgoing = [orderToValidate]; }`,
  );
});

test("recases bare reference values (camel) and dotted taxonomy.term values (Pascal.Pascal)", () => {
  assert.equal(recaseSource(`from = order-placed;`), `from = orderPlaced;`);
  assert.equal(recaseSource(`type = task-type.service;`), `type = TaskType.Service;`);
});

test("predicate member access (this.member) stays camel; keywords untouched", () => {
  assert.equal(recaseSource(`this.type == service`), `this.type == service`);
  // `this.member` stays camel even in value position (`predicate = this.event-type`)
  assert.equal(recaseSource(`predicate = this.event-type == start`), `predicate = this.eventType == start`);
});

test("comma-separated represents/uses items are all types (Pascal); [] list items are values (camel)", () => {
  assert.equal(recaseSource(`taxonomy Micro : represents location, tech-x { }`), `taxonomy Micro : represents Location, TechX { }`);
  assert.equal(recaseSource(`outgoing = [order-placed, order-to-validate];`), `outgoing = [orderPlaced, orderToValidate];`);
});

test("keywords stay lowercase even at statement start (class, import, instanceof)", () => {
  assert.equal(recaseSource(`class component web-app { }`), `class Component webApp { }`);
  // `import <path>` imports a NAMESPACE, so every segment is namespace-cased
  // (lower-camel) to match the `namespace` declaration — not a type (#10 defect 2).
  assert.equal(recaseSource(`import adl.meta-models.enums.task-type;`), `import adl.metaModels.enums.taskType;`);
  assert.equal(recaseSource(`component a instanceof web-app { }`), `Component a instanceof webApp { }`);
});

test("the full #10 repro recases to compiling source (instanceof id, namespace, term values)", () => {
  const input = `namespace acme.ea-model
{
    import acme.ea-concepts;
    taxonomy component-category : represents component { term ai-agent { label = "AI Agent"; } }
    concept component { label : string; category : component-category; }
    class component web-app { category = ai-agent; }
    model acme : acme.ea-concepts
    {
        component business-agent instanceof web-app { label = "Business Agent"; }
        component crm-api { label = "CRM"; category = ai-agent; }
    }
}`;
  const out = recaseSource(input);
  // 1: the instance id before `instanceof` is recased (no stray hyphen).
  assert.ok(out.includes("Component businessAgent instanceof webApp"));
  // 2: namespace declaration + both references agree (lower-camel, no hyphens).
  assert.ok(out.includes("namespace acme.eaModel"));
  assert.ok(out.includes("import acme.eaConcepts;"));
  assert.ok(out.includes("model Acme : acme.eaConcepts"));
  // 3: a bare term value is cased like its declaration (PascalCase).
  assert.ok(out.includes("category = AiAgent"));
  assert.ok(!out.includes("ai-agent") && !out.includes("business-agent") && !out.includes("crm-api"));
});
