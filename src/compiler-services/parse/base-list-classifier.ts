import { DeclKind, type AspectDecl, type BaseRef, type ConceptDecl, type Declaration } from "./ast.js";
import { NodeIdQualifier } from "./node-id-qualifier.js";
import { MetaKind } from "../model/kinds.js";
import type { Repository } from "../model/model.js";
import { Severity, DiagnosticCode, type Diagnostic } from "../diagnostics/diagnostic.js";

/** What a resolved base name denotes, as far as base-list classification cares. */
enum BaseKind
{
  Concept,
  Aspect,
  /** Known, but neither concept nor aspect (kept on today's `extends` path). */
  Other,
  /** No declaration anywhere; the resolver already reported it. */
  Unknown,
}

/** The outcome of classifying one concept's `:` list. */
export interface ClassifiedBases
{
  /** The single parent concept (first entry), or null. */
  parent: string | null;
  /** Included aspects, in written order. */
  aspects: string[];
}

/**
 * Classifies the `:` base list of concepts and aspects (type model R1/R2). Built once
 * per load from every parsed declaration (qualified name -> kind) plus the nodes
 * already in the model; the base names must already be resolved to canonical ids.
 */
export class BaseListClassifier
{
  private readonly kinds = new Map<string, BaseKind>();

  constructor(
    private readonly model: Repository,
    units: readonly { ns: string; decl: Declaration }[],
  )
  {
    for (const { ns, decl } of units)
    {
      if (decl.kind === DeclKind.Concept) this.kinds.set(NodeIdQualifier.Qualify(ns, decl.name), BaseKind.Concept);
      else if (decl.kind === DeclKind.Aspect) this.kinds.set(NodeIdQualifier.Qualify(ns, decl.name), BaseKind.Aspect);
      else if ("name" in decl) this.kinds.set(NodeIdQualifier.Qualify(ns, decl.name), BaseKind.Other);
    }
  }

  /** Split a concept's base list into its parent and aspects, diagnosing misplaced concepts. */
  public ClassifyConcept(decl: ConceptDecl, diagnostics: Diagnostic[]): ClassifiedBases
  {
    const result: ClassifiedBases = { parent: null, aspects: [] };
    let parentSlotTaken = false;
    decl.bases.forEach((base, i) =>
    {
      const kind = this.KindOf(base.name);
      if (kind === BaseKind.Aspect)
      {
        result.aspects.push(base.name);
        return;
      }
      if (i === 0)
      {
        result.parent = base.name; // unknown parents keep today's path: edge dropped at commit
        parentSlotTaken = true;
        return;
      }
      if (kind === BaseKind.Unknown) return;
      const code = parentSlotTaken ? DiagnosticCode.MultipleParentConcepts : DiagnosticCode.ConceptBaseNotFirst;
      const message = parentSlotTaken
        ? `concept "${decl.name}" has more than one parent concept ("${base.name}"); a concept may extend at most one concept`
        : `concept "${decl.name}" lists concept "${base.name}" after an aspect; the parent concept must come first in the base list`;
      diagnostics.push(BaseListClassifier.Error(code, message, base, decl.name));
      parentSlotTaken = true;
    });
    return result;
  }

  /** The aspects an aspect includes; a non-aspect entry is diagnosed and dropped. */
  public ClassifyAspect(decl: AspectDecl, diagnostics: Diagnostic[]): string[]
  {
    const aspects: string[] = [];
    for (const base of decl.includes)
    {
      const kind = this.KindOf(base.name);
      if (kind === BaseKind.Aspect)
      {
        aspects.push(base.name);
      }
      else if (kind !== BaseKind.Unknown)
      {
        diagnostics.push(BaseListClassifier.Error(
          DiagnosticCode.AspectIncludesNonAspect,
          `aspect "${decl.name}" includes "${base.name}", which is not an aspect; an aspect may include only aspects`,
          base, decl.name));
      }
    }
    return aspects;
  }

  private KindOf(id: string): BaseKind
  {
    const known = this.kinds.get(id);
    if (known !== undefined) return known;
    const meta = this.model.resolve(id)?.metaKind;
    if (meta === undefined) return BaseKind.Unknown;
    if (meta === MetaKind.Concept) return BaseKind.Concept;
    return meta === MetaKind.Aspect ? BaseKind.Aspect : BaseKind.Other;
  }

  private static Error(code: DiagnosticCode, message: string, base: BaseRef, owner: string): Diagnostic
  {
    return { code, severity: Severity.Error, message, span: base.span, node: owner, path: null };
  }
}
