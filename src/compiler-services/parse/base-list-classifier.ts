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
  private static readonly NotAspectAfterFirstMessage = "after the first base, but it is not an aspect; only aspects may follow the first base";
  private static readonly MultipleParentsMessage = "a concept may extend at most one concept";
  private static readonly ConceptAfterAspectMessage = "after an aspect; the parent concept must come first in the base list";
  private static readonly AspectIncludesNonAspectMessage = "which is not an aspect; an aspect may include only aspects";
  private static readonly DuplicateBaseMessage = "is listed more than once in the base list of";

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
    const seen = new Set<string>();
    let parentSlotTaken = false;
    decl.bases.forEach((base, i) =>
    {
      if (BaseListClassifier.DiagnoseDuplicate(seen, base, decl.name, diagnostics)) return;
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
      if (kind === BaseKind.Other)
      {
        diagnostics.push(BaseListClassifier.Error(
          DiagnosticCode.ConceptBaseNotFirst,
          `concept "${decl.name}" lists "${base.name}" ${BaseListClassifier.NotAspectAfterFirstMessage}`,
          base, decl.name));
        return;
      }
      const code = parentSlotTaken ? DiagnosticCode.MultipleParentConcepts : DiagnosticCode.ConceptBaseNotFirst;
      const message = parentSlotTaken
        ? `concept "${decl.name}" has more than one parent concept ("${base.name}"); ${BaseListClassifier.MultipleParentsMessage}`
        : `concept "${decl.name}" lists concept "${base.name}" ${BaseListClassifier.ConceptAfterAspectMessage}`;
      diagnostics.push(BaseListClassifier.Error(code, message, base, decl.name));
      // Still stage the first concept found as the parent so errors do not cascade
      // from the concept falling back to the Element root.
      if (result.parent === null) result.parent = base.name;
      parentSlotTaken = true;
    });
    return result;
  }

  /** The aspects an aspect includes; a non-aspect entry is diagnosed and dropped. */
  public ClassifyAspect(decl: AspectDecl, diagnostics: Diagnostic[]): string[]
  {
    const aspects: string[] = [];
    const seen = new Set<string>();
    for (const base of decl.includes)
    {
      if (BaseListClassifier.DiagnoseDuplicate(seen, base, decl.name, diagnostics)) continue;
      const kind = this.KindOf(base.name);
      if (kind === BaseKind.Aspect)
      {
        aspects.push(base.name);
      }
      else if (kind !== BaseKind.Unknown)
      {
        diagnostics.push(BaseListClassifier.Error(
          DiagnosticCode.AspectIncludesNonAspect,
          `aspect "${decl.name}" includes "${base.name}", ${BaseListClassifier.AspectIncludesNonAspectMessage}`,
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

  /** True (after a warning) when `base` repeats an earlier entry of the same list. */
  private static DiagnoseDuplicate(seen: Set<string>, base: BaseRef, owner: string, diagnostics: Diagnostic[]): boolean
  {
    if (!seen.has(base.name))
    {
      seen.add(base.name);
      return false;
    }
    diagnostics.push({
      code: DiagnosticCode.DuplicateBase,
      severity: Severity.Warning,
      message: `"${base.name}" ${BaseListClassifier.DuplicateBaseMessage} "${owner}"`,
      span: base.span, node: owner, path: null,
    });
    return true;
  }

  private static Error(code: DiagnosticCode, message: string, base: BaseRef, owner: string): Diagnostic
  {
    return { code, severity: Severity.Error, message, span: base.span, node: owner, path: null };
  }
}
