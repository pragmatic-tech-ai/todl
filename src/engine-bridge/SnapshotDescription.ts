import type { ISchemaDescription } from '@pragmatic-tech-ai/graph';
import type { ModelConnectorPlan } from '../model-data/connector-plan.js';

export interface IDescribeOptions
{
    /** The connector for nodes no binding matches (passed through to the description). */
    readonly DefaultConnector: string;
    /**
     * Connector plans whose bindings route concepts. A plan's `Model` is passed through unchanged as the binding's
     * Model, so it must already be in the seed Owner identifier space: the package model id (`PackageRef.model`, what
     * `MetadataSnapshot.HomeModelOf` gives), not the TODL `model` declaration name.
     */
    readonly ConnectorPlans?: readonly ModelConnectorPlan[];
}

export interface ISnapshotDescription
{
    readonly Description: ISchemaDescription;
    /** Concepts bound to a non-.todl connector (no data in M1; the host denies writes). */
    readonly External: ReadonlySet<string>;
    readonly Diagnostics: readonly IDescribeDiagnostic[];
}

/** Why part of the snapshot was left out of the description. Append-only. */
export enum DescribeDiagnosticCode
{
    /** A value whose type does not fit its member's value type; the value is skipped. */
    ValueTypeMismatch = 1,
    /** A link whose target id is not in the snapshot; the link is dropped. */
    DanglingLink,
    /** A non-integral number on an integer field; the value is skipped. */
    NonIntegralInteger,
    /** A value or link under a name that is not a member of the node's concept; it is skipped. */
    UnknownMember,
    /** A heap node whose type is not a described concept; the node is skipped. */
    UnknownConcept,
    /** A redeclared member that disagrees with the inherited one; the inherited member wins. */
    MemberRedeclared,
    /** An integer value outside the signed 64-bit range, or a non-decimal (double-borne) one beyond 2^53 that may have
     *  lost precision; the value is skipped. */
    IntegerOutOfRange,
    /** A field type or relationship target that does not resolve; the member falls back (opaque String / any element). */
    UnresolvedType,
    /** A heap node no package bound (no origin model to own it); the node is skipped. */
    Unattributed,
    /** A plan binding with an empty Model or an undescribed concept; the binding is skipped. */
    InvalidBinding,
    /** A (Model, Concept) bound to two different connectors; the first binding is kept. */
    DuplicateBinding,
    /** Two inherited or carried members of one name (two aspects, or a parent and an aspect); the later source's
     *  declaration is dropped from its definition (the first source wins, as effectiveSchema). */
    MemberCollision,
    /** An extends or aspect-inclusion cycle; the closing edge is dropped (a parent falls back to the root). */
    InheritanceCycle,
}

export interface IDescribeDiagnostic
{
    readonly Code: DescribeDiagnosticCode;
    /** What the diagnostic is about: a node id, `nodeId.member` or `definition.member`. */
    readonly Subject: string;
    readonly Message: string;
}
