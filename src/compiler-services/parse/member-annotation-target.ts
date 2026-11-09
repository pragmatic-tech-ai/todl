import type { MemberAnnotationDecl } from "./ast.js";
import type { NodeId } from "../model/graph.js";
import type { Repository } from "../model/model.js";
import { Severity, DiagnosticCode, type Diagnostic } from "../diagnostics/diagnostic.js";

/**
 * Checks the target of a `member <name> { annotate … }` block (R6): the member must
 * be inherited from a supertype or contributed by an aspect. A concept's own member
 * is annotated in its own declaration instead (and its relationship node already
 * owns the `<concept>.<member>` id). Runs once concept schemas are committed.
 */
export class MemberAnnotationTarget
{
  private static readonly OwnMemberMessage = "is declared by the concept itself; annotate it in its declaration, not in a member block";
  private static readonly UnknownMemberMessage = "is not an inherited or aspect-contributed member of";

  /** A diagnostic when `decl` may not be staged on `concept`, else null. */
  public static Diagnose(model: Repository, concept: NodeId, decl: MemberAnnotationDecl): Diagnostic | null
  {
    const own = model.schemaOf(concept);
    if (own.fields.some((f) => f.name === decl.member) || own.relationships.some((r) => r.name === decl.member))
    {
      return MemberAnnotationTarget.Error(concept, decl, `member "${decl.member}" ${MemberAnnotationTarget.OwnMemberMessage}`);
    }
    const effective = model.effectiveSchema(concept);
    if (effective.fields.some((f) => f.name === decl.member) || effective.relationships.some((r) => r.name === decl.member))
    {
      return null;
    }
    return MemberAnnotationTarget.Error(concept, decl, `"${decl.member}" ${MemberAnnotationTarget.UnknownMemberMessage} "${concept}"`);
  }

  private static Error(concept: NodeId, decl: MemberAnnotationDecl, message: string): Diagnostic
  {
    return {
      code: DiagnosticCode.MemberAnnotationTargetInvalid,
      severity: Severity.Error,
      message,
      span: decl.span,
      node: concept,
      path: `${concept}.${decl.member}`,
    };
  }
}
