import { Manifest, type TypeInfo } from "../reflection/reflection.js";

/** A stable, JSON-comparable digest of everything reflection exposes about a manifest's types. */
export class ReflectionSummary
{
    public static Of(manifest: Manifest): unknown
    {
        return {
            model: manifest.model,
            version: manifest.version,
            root: manifest.root().token === 0 ? "" : manifest.root().fullName,
            types: manifest.types().map((t) => ReflectionSummary.TypeOf(t)),
        };
    }

    private static TypeOf(t: TypeInfo): unknown
    {
        return {
            fullName: t.fullName,
            kind: t.kind,
            base: t.baseType?.fullName ?? null,
            supertypes: t.getSupertypes().map((s) => s.fullName),
            fields: t.getFields().map((f) => [f.name, f.fieldType?.fullName ?? null, f.cardinality, f.declaringType.fullName]),
            rels: t.getRelationships().map((r) => [r.name, r.targets.map((x) => x.fullName), r.cardinality, r.inverse, r.declaringType.fullName]),
            annotations: t.getAnnotations().map((a) => [a.type.fullName, [...a.args.entries()]]),
        };
    }
}
