/**
 * The meta-kind a node's `typeOf` points at when the node is an ontology
 * declaration. Shared between the {@link Builder} (which stamps it) and the
 * JS-module emitter (which partitions the ontology tier by it).
 */
export enum MetaKind
{
  Concept = "concept",
  Primitive = "primitive",
  Taxonomy = "taxonomy",
  Term = "term", // a taxonomy term / class — a first-class construct (SPEC-01 #6)
  Viewpoint = "viewpoint",
  Field = "field",
  Relationship = "relationship",
  Model = "model",
  Annotation = "annotation",
  Package = "package",
  Operator = "operator",
  Identity = "identity",
  Match = "match",
  Merge = "merge",
  Connector = "connector",
  Population = "population",
  Aspect = "aspect",
  /** A concept's handle `<concept>.<member>` on an inherited/contributed member; hosts member annotations (R6). */
  MemberTarget = "member-target",
  /** A package role: `<ns>.<name>@role`, carrying its privileges. */
  Role = "role",
  /** A package's privileges added to a platform base role: `<ns>.<baseRole>@contribution`. */
  RoleContribution = "role-contribution",
  /** A named set of field rights: `<ns>.<name>@profile`. */
  FieldProfile = "field-profile",
}

/** Reserved id of the singleton package node that hosts package-level annotations. */
export const PACKAGE_NODE_ID = "package";
