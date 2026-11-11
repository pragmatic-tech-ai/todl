import type { NodeId } from "../model/graph.js";
import type { SourceSpan } from "./span.js";

export enum Severity
{
  Error = "error",
  Warning = "warning",
}

export enum DiagnosticCode
{
  // Lex / parse (syntax) phase.
  UnexpectedCharacter = "syntax.unexpected-character",
  UnterminatedString = "syntax.unterminated-string",
  UnexpectedToken = "syntax.unexpected-token",
  ExpectedToken = "syntax.Expected",
  // Semantic phase (unchanged values).
  RequiredMissing = "cardinality.required-missing",
  TooMany = "cardinality.too-many",
  EmptyNotAllowed = "cardinality.empty-not-allowed",
  TargetTypeMismatch = "relationship.target-type",
  BooleanValueInvalid = "type.boolean-invalid",
  // A scalar value whose literal is not valid for the field's resolved base
  // type (e.g. a non-numeric string on an `integer` field).
  ScalarValueInvalid = "type.value-invalid",
  // A scalar value that does not match a `regex` of its primitive type.
  RegexMismatch = "type.regex-mismatch",
  // An assignment to a member the instance's concept (and supertypes) does not declare.
  MemberUnknown = "member.unknown",
  InvariantFailed = "invariant.failed",
  // Class + taxonomy phase.
  ClassOverride = "Class.override",
  BindingInvalid = "Class.binding-invalid",
  TaxonomyNoRepresentedConcept = "taxonomy.no-represented-concept",
  TaxonomyValueUnresolved = "taxonomy.value-unresolved",
  TermConceptNotRepresented = "taxonomy.term-concept-not-represented",
  TaxonomyTermConceptAmbiguous = "taxonomy.term-concept-ambiguous",
  ContainsTargetNotTerm = "taxonomy.contains-target-not-term",
  ViewpointNoFramedConcept = "viewpoint.no-framed-concept",
  ViewpointFramesNotConcept = "viewpoint.frames-not-concept",
  // Instance-loading phase.
  AmbiguousFieldBinding = "Instance.ambiguous-field-binding",
  // A concrete record id re-declared a second time: the later fields merge onto
  // the first node and a nested re-declaration loses its own containment, so the
  // collision is reported at the second declaration.
  InstanceDuplicateId = "instance.duplicate-id",
  // A member's value shape does not match its declared type (e.g. a reference
  // member given a quoted string, or a value member given a list).
  MemberValueKind = "member.value-kind",
  // An inline object assigned to a non-concept-typed member.
  InlineObjectTarget = "inline-object.target",
  // An inline object whose concept is not the field's type or a subtype.
  InlineObjectType = "inline-object.type",
  // Operators (design §5).
  OperatorUndefined = "operator.undefined",
  OperatorRedeclared = "operator.redeclared",
  OperatorMalformedGlyph = "operator.malformed-glyph",
  OperatorBadEndpoint = "operator.bad-endpoint",
  OperatorBodyOnRelationship = "operator.body-on-relationship",
  OperatorSourceType = "operator.source-type",
  OperatorNotAValue = "operator.not-a-value",
  // Reference-resolution phase.
  ReferenceUndefined = "reference.undefined",
  // A symbol exists but lives in a namespace this reference's home namespace
  // does not import (and is not the reference's own namespace). Distinct from
  // reference.undefined so "you forgot an import" reads differently from "no
  // such symbol" — the migration to namespace-scoped resolution is mechanical.
  ReferenceUnreachable = "reference.unreachable",
  // Taxonomy bare-reference resolution.
  TaxonomyAmbiguousBareReference = "taxonomy.ambiguous-bare-reference",
  TaxonomyUsesUndefined = "taxonomy.uses-undefined",
  // Model phase.
  InstanceOrphan = "instance.orphan",
  ModelBindingUndefined = "model.binding-undefined",
  ModelConformsNotViewpoint = "model.conforms-not-viewpoint",
  ModelEntityNotFramed = "model.entity-not-framed",
  ModelConformsRequiredWhenSplit = "model.conforms-required-when-split",
  ConstructorOutOfScope = "constructor.out-of-scope",
  // Prelude (default library) phase.
  PreludeNameRedeclared = "prelude.name-redeclared",
  // Annotation phase.
  AnnotationDuplicate = "annotation.duplicate",
  AnnotationUnknownParam = "annotation.unknown-param",
  AnnotationInvalidTarget = "annotation.invalid-target",
  AnnotationBaseNotAnnotation = "annotation.base-not-annotation",
  AnnotationParamRedeclared = "annotation.param-redeclared",
  // Application root selection (Wave 2).
  ApplicationMultipleRoots = "application.multiple-roots",
  ApplicationRootUndesignated = "application.root-undesignated",
  ApplicationRootNotAModel = "application.root-not-a-model",
  // Entity-identity declarations: the concept must exist, and the key must be one of
  // its fields (or the reserved `storageId`).
  IdentityUnknownConcept = "identity.unknown-concept",
  IdentityUnknownKey = "identity.unknown-key",
  MatchUnknownConcept = "match.unknown-concept",
  MatchUnknownField = "match.unknown-field",
  MatchUnsupportedRule = "match.unsupported-rule",
  MergeUnknownConcept = "merge.unknown-concept",
  MergeUnknownField = "merge.unknown-field",
  PolicyUnknownConcept = "policy.unknown-concept",
  PolicyUnknownField = "policy.unknown-field",
  PolicyUnsupportedRule = "policy.unsupported-rule",
  // External-data connectors: `populate` must name a real concept, real members, one
  // population per concept per model, and a resolvable connector.
  ConnectorUnknownConcept = "connector.unknown-concept",
  ConnectorUnknownField = "connector.unknown-field",
  ConnectorDuplicatePopulate = "connector.duplicate-populate",
  ConnectorUnresolvedConnector = "connector.unresolved-connector",
  ConnectorUnknownKind = "connector.unknown-kind",
  ConnectorInlineForbidden = "connector.inline-forbidden",
  ConnectorProviderForbidden = "connector.provider-forbidden",
  ConnectorReadOnly = "connector.read-only",
  ConnectorWriteConflict = "connector.write-conflict",
  ConnectorWriteFailed = "connector.write-failed",
  ConnectorRefreshDropped = "connector.refresh-dropped",
  // Two declarations of one namespace-scoped datasource id (in two bases, or a source over a base) that differ.
  ConnectorConflictingDeclaration = "connector.conflicting-declaration",
  ResolutionUnmergedConflict = "resolution.unmerged-conflict",
  // Solution composition phase (SPEC-06): a member/dependency package could not
  // be resolved or loaded into the composed Domain.
  PackageUnresolved = "package.unresolved",
  // Type-model aspects (R2): base-list ordering and aspect inclusion rules.
  ConceptBaseNotFirst = "type.concept-base-not-first",
  MultipleParentConcepts = "type.multiple-parent-concepts",
  AspectIncludesNonAspect = "type.aspect-includes-non-aspect",
  DuplicateBase = "type.duplicate-base",
  // Type-model rules (R4/R5/R7/R11): no overriding, collisions are errors, aspects are not instance types.
  MemberRedeclared = "type.member-redeclared",
  MemberCollision = "type.member-collision",
  AspectNotInstantiable = "type.aspect-not-instantiable",
  DeriveTargetNotContributed = "type.derive-target-not-contributed",
  InheritanceCycle = "type.inheritance-cycle",
  MultipleExtendsEdges = "type.multiple-extends-edges",
  MalformedDerives = "type.malformed-derives",
  // Type-model follow-ups (R6/R7): derived members, member-annotation targets, duplicate derives.
  DerivedMemberAssigned = "type.derived-member-assigned",
  MemberAnnotationTargetInvalid = "type.member-annotation-target-invalid",
  DuplicateDerive = "type.duplicate-derive",
  // Saved-snapshot compile (engine bridge): a listed saved model no source declares, one listed twice, or one whose
  // id is the solution name (whose package owns the instances outside every model).
  SavedModelUndeclared = "saved-model.undeclared",
  SavedModelDuplicate = "saved-model.duplicate",
  SavedModelSolutionCollision = "saved-model.solution-collision",
}

export interface Diagnostic
{
  code: DiagnosticCode;
  severity: Severity;
  message: string;
  /** Source location; `null` only for genuine whole-model diagnostics. */
  span: SourceSpan | null;
  /** Semantic phase: the offending node; `null` for syntax diagnostics. */
  node: NodeId | null;
  /** Semantic phase: concept-qualified member path (`component.label`); else `null`. */
  path: string | null;
}
