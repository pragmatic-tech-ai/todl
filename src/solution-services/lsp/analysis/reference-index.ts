import type { Range, Position } from "vscode-languageserver-types";
import type { NamespaceNode } from "../../../compiler-services/parse/ast.js";
import { visitReferences, RefRole } from "../../../compiler-services/parse/references.js";
import { Positions } from "./positions.js";

// Occurrence roles for the editor — the language-service's view of a reference's
// kind. Derived from the shared-walk RefRole so the reference-index and the
// loader agree on WHAT a reference is; this enum stays the editor-facing surface.
export enum Role { Extends, FieldType, RelationshipTarget, RefValue, InstanceConcept, InstanceOf, Import, Represents, AnnotationName }

export interface Occurrence { Uri: string; Range: Range; Role: Role; Symbol: string }

export class ReferenceIndex
{
    private readonly occurrences: Occurrence[];
    private readonly bySymbol: Map<string, Occurrence[]>;

    private constructor(occurrences: Occurrence[])
    {
        this.occurrences = occurrences;
        this.bySymbol = new Map<string, Occurrence[]>();
        for (const occ of occurrences)
        {
            const list = this.bySymbol.get(occ.Symbol);
            if (list === undefined) this.bySymbol.set(occ.Symbol, [occ]);
            else list.push(occ);
        }
    }

    public static Build(files: Map<string, NamespaceNode>): ReferenceIndex
    {
        const occurrences: Occurrence[] = [];
        for (const [uri, ns] of files)
        {
            for (const span of ns.importSpans ?? [])
            {
                occurrences.push({ Uri: uri, Symbol: "", Role: Role.Import, Range: Positions.SpanToRange(span) });
            }
            // One shared walk — the SAME one the loader resolves through, so occurrences
            // and resolution can never disagree on what a reference is.
            for (const decl of ns.declarations)
            {
                visitReferences(decl, (v) =>
                {
                    if (v.span === undefined) return;
                    occurrences.push({ Uri: uri, Symbol: v.name, Role: ReferenceIndex.RoleOf(v.role), Range: Positions.SpanToRange(v.span) });
                });
            }
        }
        return new ReferenceIndex(occurrences);
    }

    // A copy, so a caller can't mutate the index's internal occurrence list.
    public All(): Occurrence[]
    {
        return [...this.occurrences];
    }

    public Get(symbol: string): Occurrence[]
    {
        return this.bySymbol.get(symbol) ?? [];
    }

    public OccurrenceAt(uri: string, pos: Position): Occurrence | null
    {
        return this.occurrences.find((o) => o.Uri === uri && Positions.Contains(o.Range, pos)) ?? null;
    }

    private static RoleOf(r: RefRole): Role
    {
        switch (r)
        {
            case RefRole.Extends: return Role.Extends;
            case RefRole.FieldType: return Role.FieldType;
            case RefRole.ParamType: return Role.FieldType;
            case RefRole.RelationshipTarget: return Role.RelationshipTarget;
            case RefRole.Represents: return Role.Represents;
            // A viewpoint's `frames` reference is a concept reference like `represents`;
            // reuse the editor role (occurrences are keyed by symbol, not role).
            case RefRole.Frames: return Role.Represents;
            case RefRole.RecordConcept: return Role.InstanceConcept;
            case RefRole.InstanceOf: return Role.InstanceOf;
            case RefRole.RefValue: return Role.RefValue;
            case RefRole.AnnotationName: return Role.AnnotationName;
        }
    }
}
