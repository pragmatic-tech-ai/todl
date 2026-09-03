import { tokenize, parse, type TodlDocument } from "@pragmatic-tech-ai/todl";
import type { ExampleSource, GoldenDiagnostic } from "./corpus-types.js";
import { compileForDisplay } from "./compile-for-display.js";
import { selectOwnDocument } from "./verify.js";
import { nodeLabel } from "./graph-layout.js";

export interface TokenRow { kind: string; value: string; line: number; column: number }
export interface ModelRow { id: string; tier: string; typeOf: string; label: string }
export interface StageResult {
  tokens: TokenRow[]; astText: string;
  modelRows: ModelRow[]; edgeRows: { kind: string; from: string; to: string }[];
  diagnostics: GoldenDiagnostic[];
  /** Canonicalized own document — the toggle-driven JSON tab / download source. */
  document: TodlDocument;
  /** Own document WITH debug names, for the graph so nodes render by name (via
   *  nodeLabel's debug preference) instead of by opaque canonical id. */
  graphDocument: TodlDocument;
}

// Numeric AST enums aren't re-exported from the package; inline the names so the
// JSON reads well — the raw AST stores `kind` as a number. (DeclKind / ValueKind
// from parse/ast.)
const DECL = ["Primitive", "Taxonomy", "Viewpoint", "Concept", "Instance", "Model", "Annotation", "Package", "Operator"];
const VALUE = ["String", "Name", "List", "Composite", "Boolean", "Object", "Edge"];

/** `JSON.stringify` replacer that turns the raw AST into readable JSON:
 *  - drops `span` keys (source-position noise), and
 *  - renders the numeric `kind` discriminant as its enum name (Concept, Model,
 *    String, …) using the parent object to disambiguate DeclKind vs ValueKind
 *    (both start at 0; a value node carries text/parts/items/edge). */
function astReplacer(this: Record<string, unknown>, key: string, value: unknown): unknown {
  if (/span/i.test(key)) return undefined;
  if (key === "kind" && typeof value === "number") {
    const o = this;
    const isValue = o.text !== undefined || o.parts !== undefined || o.items !== undefined || o.edge !== undefined;
    return (isValue ? VALUE[value] ?? DECL[value] : DECL[value] ?? VALUE[value]) ?? value;
  }
  return value;
}

/** The parse-time AST serialized as JSON (span noise stripped, `kind` named). */
function formatAst(namespace: unknown): string {
  return JSON.stringify(namespace, astReplacer, 2);
}

export function compileStages(source: ExampleSource, options?: { debug?: boolean }): StageResult {
  const tokens: TokenRow[] = tokenize(source.text).map((t) => ({ kind: t.kind, value: t.value, line: t.line, column: t.column }));
  const parsed = parse(source.text, source.name);
  const astText = parsed.diagnostics.length
    ? `parse: ${parsed.diagnostics[0].message}\n\n${formatAst(parsed.namespace)}`
    : formatAst(parsed.namespace);
  const display = compileForDisplay([source], options);
  // Build the model view by NAME, not by id. Canonicalization rewrites every node
  // id to an opaque `#n0`/`#r0`, but the opt-in `debug` block carries the real
  // names (concept ids, instance name attrs, edge endpoint names — resolved even to
  // base/prelude nodes) and survives that rewrite. So re-emit the OWN document with
  // debug from the same compiled model (no recompile) purely to read those names.
  const named = selectOwnDocument(display.model, [], { debug: true, provenance: display.provenance });
  const modelRows: ModelRow[] = named.nodes.map((n) => ({
    id: String(n.id), tier: n.tier, typeOf: n.debug?.type ?? String(n.typeOf), label: n.debug?.name ?? nodeLabel(n),
  }));
  const edgeRows = named.edges.map((e) => ({
    kind: e.kind, from: e.debug?.from ?? String(e.from), to: e.debug?.to ?? String(e.to),
  }));
  return { tokens, astText, modelRows, edgeRows, diagnostics: display.diagnostics, document: display.document, graphDocument: named };
}
