// Serializable projections of reflection handles (arc 1b-i). Plain JSON so the query
// surface keeps a transport-agnostic boundary; depends only on manifest-layer types.

import { MetaKind, Cardinality } from "../manifest/enums.js";
import type { Scalar } from "../manifest/logical.js";
import type { InstanceMirror, TypeInfo } from "../manifest/reflection/reflection.js";

/** One field's value plus its two provenance origins (Axis 1 / Axis 2). */
export interface FieldSnapshot
{
    value: Scalar | undefined;
    definitionOrigin: string; // TypeInfo.fullName where the field is declared
    valueOrigin: string;      // TermInfo.id that fixes the value, or "self"
}

/** A shallow, serializable projection of one heap instance. */
export interface MirrorSnapshot
{
    id: string;
    concept: string;
    class?: string;
    label: string;
    fields: Record<string, FieldSnapshot>;
    refs: Record<string, string[]>;
    iconKey?: string; // reserved for 1b-iv; never populated here
}

export interface FieldSchemaSnapshot { name: string; type: string; cardinality: Cardinality; }
export interface RelSchemaSnapshot { name: string; targets: string[]; cardinality: Cardinality; inverse: string | null; }
export interface AnnotationSnapshot { annotation: string; args: Record<string, Scalar>; }

/** A serializable projection of a concept/type (folds ConceptSummary + ElementSchema). */
export interface TypeSnapshot
{
    name: string;
    label: string;
    namespace: string;
    extends: string | null;
    kind: string;
    fields: FieldSchemaSnapshot[];
    relationships: RelSchemaSnapshot[];
    annotations: AnnotationSnapshot[];
    iconKey?: string; // reserved for 1b-iv; never populated here
}

/** Stateless projector: reflection handle -> plain-JSON snapshot. */
export class Snapshot
{
    private static readonly LabelField = "label";
    private static readonly NameField = "name";
    private static readonly SelfOrigin = "self";

    /** Display label: label -> name -> id (the reflection twin of the doc rule). */
    public static LabelOf(mirror: InstanceMirror): string
    {
        const v = mirror.field(Snapshot.LabelField)?.value ?? mirror.field(Snapshot.NameField)?.value;
        return v !== undefined ? String(v) : mirror.node.id;
    }

    public static of(mirror: InstanceMirror): MirrorSnapshot
    {
        const fields: Record<string, FieldSnapshot> = {};
        for (const fv of mirror.fields())
        {
            fields[fv.field.name] = {
                value: fv.value,
                definitionOrigin: fv.definitionOrigin.fullName,
                valueOrigin: fv.valueOrigin === Snapshot.SelfOrigin ? Snapshot.SelfOrigin : fv.valueOrigin.id,
            };
        }
        const snap: MirrorSnapshot = {
            id: mirror.node.id,
            concept: mirror.type.fullName,
            label: Snapshot.LabelOf(mirror),
            fields,
            refs: { ...(mirror.node.refs ?? {}) },
        };
        if (mirror.class !== undefined) snap.class = mirror.class.id;
        return snap;
    }

    public static ofType(type: TypeInfo): TypeSnapshot
    {
        return {
            name: type.fullName,
            label: type.name,
            namespace: type.namespace,
            extends: type.baseType?.fullName ?? null,
            kind: MetaKind[type.kind],
            fields: type.getFields().map((f) => ({ name: f.name, type: f.fieldType?.fullName ?? "", cardinality: f.cardinality })),
            relationships: type.getRelationships().map((r) => ({ name: r.name, targets: r.targets.map((t) => t.fullName), cardinality: r.cardinality, inverse: r.inverse })),
            annotations: type.getAnnotations().map((a) => ({ annotation: a.type.name, args: Object.fromEntries(a.args) })),
        };
    }
}
