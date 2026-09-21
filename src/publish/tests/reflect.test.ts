import { test } from "node:test";
import assert from "node:assert/strict";
import type { TodlDocument } from "../../compiler-services/emit/json.js";
import { MetaKind } from "../../compiler-services/model/kinds.js";
import { deriveClasses, projectAnnotations } from "../reflect.js";

// A compiled doc with one clabject `az` (class=true) carrying a label and an
// `icon` annotation application `az@icon { path = "resources/az.svg" }`.
function doc(): TodlDocument
{
  return {
    nodes: [
      { id: "ms.az", tier: "Instance", type: "location", metaKind: null, namespace: null, localId: "az", isClass: true, class: null, storageId: null, fields: [], attrs: { label: "Azure" } },
      { id: "ms.az@icon", tier: "Instance", type: "icon", metaKind: null, namespace: "ms", localId: null, isClass: false, class: null, storageId: null, fields: [], attrs: { path: "resources/az.svg" } },
      { id: "ms.Other", tier: "Ontology", type: null, metaKind: MetaKind.Concept, namespace: null, localId: "other", isClass: false, class: null, storageId: null, fields: [], attrs: {} },
    ],
    edges: [{ kind: "Annotated", via: null, from: "ms.az", to: "ms.az@icon" }],
  };
}

test("projectAnnotations keys applications by annotation name, strips namespace", () => {
  assert.deepEqual(projectAnnotations(doc(), "ms.az"), { icon: { path: "resources/az.svg" } });
  assert.deepEqual(projectAnnotations(doc(), "ms.Missing"), {});
});

// Richer cases (ported from Plexus annotation-projection.test.ts when that copy
// was retired): multiple annotations on one target, dangling edge skipped, and a
// non-Annotated edge ignored.
test("projectAnnotations: multi-annotation, dangling edge skipped, non-annotation edge ignored", () => {
  const doc2: TodlDocument = {
    nodes: [
      { id: "actor", tier: "Ontology", type: null, metaKind: MetaKind.Concept, namespace: null, localId: null, isClass: false, class: null, storageId: null, fields: [], attrs: { label: "Human Actor" } },
      { id: "actor@icon", tier: "Ontology", type: "icon", metaKind: null, namespace: "acme", localId: null, isClass: false, class: null, storageId: null, fields: [], attrs: { path: "icons/actor.svg" } },
      { id: "actor@category", tier: "Ontology", type: "category", metaKind: null, namespace: "acme", localId: null, isClass: false, class: null, storageId: null, fields: [], attrs: { name: "actors", order: 1 } },
      { id: "bare", tier: "Ontology", type: null, metaKind: MetaKind.Concept, namespace: null, localId: null, isClass: false, class: null, storageId: null, fields: [], attrs: {} },
    ],
    edges: [
      { kind: "Annotated", via: null, from: "actor", to: "actor@icon" },
      { kind: "Annotated", via: null, from: "actor", to: "actor@category" },
      { kind: "Annotated", via: null, from: "actor", to: "missing@ghost" }, // dangling → skipped
      { kind: "HasField", via: null, from: "actor", to: "Actor.name" }, // non-annotation edge ignored
    ],
  };
  assert.deepEqual(projectAnnotations(doc2, "actor"), {
    icon: { path: "icons/actor.svg" },
    category: { name: "actors", order: 1 },
  });
  assert.deepEqual(projectAnnotations(doc2, "bare"), {});
});

test("projectAnnotations indexes an application under its annotation's ancestors (polymorphism)", () => {
  // detailed : visual ; X carries @detailed → queryable as detailed AND visual.
  const doc2: TodlDocument = {
    nodes: [
      { id: "visual", tier: "Ontology", type: null, metaKind: MetaKind.Annotation, namespace: null, localId: null, isClass: false, class: null, storageId: null, fields: [], attrs: {} },
      { id: "detailed", tier: "Ontology", type: null, metaKind: MetaKind.Annotation, namespace: null, localId: null, isClass: false, class: null, storageId: null, fields: [], attrs: {} },
      { id: "X", tier: "Ontology", type: null, metaKind: MetaKind.Concept, namespace: null, localId: null, isClass: false, class: null, storageId: null, fields: [], attrs: {} },
      { id: "X@detailed", tier: "Ontology", type: "detailed", metaKind: null, namespace: "n", localId: null, isClass: false, class: null, storageId: null, fields: [], attrs: { icon: "a.svg", badge: "new" } },
    ],
    edges: [
      { kind: "Extends", via: null, from: "detailed", to: "visual" },
      { kind: "Annotated", via: null, from: "X", to: "X@detailed" },
    ],
  };
  const got = projectAnnotations(doc2, "X");
  assert.deepEqual(got.detailed, { icon: "a.svg", badge: "new" });
  assert.deepEqual(got.visual, { icon: "a.svg", badge: "new" }); // is-a base
});

test("deriveClasses returns only class=true Instance clabjects with label + annotation icon", () => {
  assert.deepEqual(deriveClasses(doc()), [
    { id: "ms.az", concept: "location", localId: "az", label: "Azure", icon: "resources/az.svg" },
  ]);
});

// An own-only document holds the class + its annotation APPLICATION, but not the
// base annotation-declaration nodes. An icon reachable only via the
// `special : icon` inheritance chain is therefore lost from the own document
// alone, and recovered when annotations are projected from the full closure.
test("deriveClasses resolves inherited icons from an optional annotationsFrom document", () => {
  const ownDoc: TodlDocument = {
    nodes: [
      { id: "X", tier: "Instance", type: "widget", metaKind: null, namespace: null, localId: "x", isClass: true, class: null, storageId: null, fields: [], attrs: { label: "X" } },
      { id: "X@special", tier: "Instance", type: "special", metaKind: null, namespace: "lib", localId: null, isClass: false, class: null, storageId: null, fields: [], attrs: { path: "s.svg" } },
    ],
    edges: [{ kind: "Annotated", via: null, from: "X", to: "X@special" }],
  };
  const fullDoc: TodlDocument = {
    nodes: [
      ...ownDoc.nodes,
      { id: "widget", tier: "Ontology", type: null, metaKind: MetaKind.Concept, namespace: null, localId: null, isClass: false, class: null, storageId: null, fields: [], attrs: {} },
      { id: "special", tier: "Ontology", type: null, metaKind: MetaKind.Annotation, namespace: null, localId: null, isClass: false, class: null, storageId: null, fields: [], attrs: {} },
      { id: "icon", tier: "Ontology", type: null, metaKind: MetaKind.Annotation, namespace: null, localId: null, isClass: false, class: null, storageId: null, fields: [], attrs: {} },
    ],
    edges: [...ownDoc.edges, { kind: "Extends", via: null, from: "special", to: "icon" }],
  };

  // Own-only: class found, inherited icon lost.
  const ownOnly = deriveClasses(ownDoc);
  assert.equal(ownOnly.length, 1);
  assert.equal(ownOnly[0]!.id, "X");
  assert.equal(ownOnly[0]!.icon, undefined);

  // Enriched from the full document: the special→icon chain resolves the icon.
  const enriched = deriveClasses(ownDoc, fullDoc);
  assert.equal(enriched.length, 1, "still enumerates only the own class");
  assert.equal(enriched[0]!.icon, "s.svg");
});
