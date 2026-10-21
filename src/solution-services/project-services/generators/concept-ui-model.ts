/**
 * Scalar-field introspection of a concept for UI generation: the single-valued
 * primitive fields a generated list/form binds to, with identifier-safe binding names.
 */

import { Cardinality } from "../../../compiler-services/model/graph.js";
import { ELEMENT_ID, type FieldSchema, type Repository } from "../../../compiler-services/model/model.js";
import { isMany, isReferenceType, scalarTsType } from "../../../codegen/read-client.js";
import { pascalCase } from "../../../codegen/naming.js";

export enum UiFieldType
{
    String,
    Number,
    Boolean,
}

export interface UiField
{
    readonly Name: string;
    readonly BindingName: string;
    readonly Type: UiFieldType;
    readonly Required: boolean;
}

export class ConceptUiModel
{
    private static readonly Reserved: ReadonlySet<string> = new Set([
        "abstract", "as", "async", "await", "break", "case", "catch", "class", "const", "continue",
        "debugger", "default", "delete", "do", "else", "enum", "export", "extends", "false", "finally",
        "for", "function", "if", "implements", "import", "in", "instanceof", "interface", "let", "new",
        "null", "package", "private", "protected", "public", "return", "static", "super", "switch",
        "this", "throw", "true", "try", "typeof", "var", "void", "while", "with", "yield",
        "Text", "Content", "Children", "Name", "Visibility", "DataContext", "Style", "Tag",
    ]);
    private static readonly ReservedSuffix = "Field";
    private static readonly NonIdentifier = /[^A-Za-z0-9_$]/g;
    private static readonly LeadingDigit = /^[0-9]/;
    private static readonly DigitPrefix = "_";
    private static readonly EmptyFallback = "field";
    private static readonly NamespaceSeparator = ".";
    private static readonly NumberType = "number";
    private static readonly BooleanType = "boolean";

    private constructor(
        public readonly Concept: string,
        public readonly ClassName: string,
        public readonly Fields: readonly UiField[])
    {
    }

    public static For(repo: Repository, concept: string): ConceptUiModel
    {
        const fields: UiField[] = ConceptUiModel.OwnFields(repo, concept)
            .filter(f => !isReferenceType(repo, f.type) && !isMany(f.cardinality))
            .map(f => ({
                Name: f.name,
                BindingName: ConceptUiModel.SafeIdentifier(f.name),
                Type: ConceptUiModel.TypeOf(f.type),
                Required: f.cardinality === Cardinality.One || f.cardinality === Cardinality.OneOrMore,
            }))
            .sort((a, b) => (a.Name < b.Name ? -1 : a.Name > b.Name ? 1 : 0));
        ConceptUiModel.Disambiguate(fields);
        const local = concept.substring(concept.lastIndexOf(ConceptUiModel.NamespaceSeparator) + 1);
        return new ConceptUiModel(concept, pascalCase(local), fields);
    }

    /** Fields declared on the concept or its user-defined bases; the prelude root's universal fields are excluded. */
    private static OwnFields(repo: Repository, concept: string): FieldSchema[]
    {
        const seen = new Map<string, FieldSchema>();
        for (const declaring of [concept, ...repo.supertypesOf(concept)])
        {
            if (declaring === ELEMENT_ID)
            {
                continue;
            }
            for (const field of repo.schemaOf(declaring).fields)
            {
                if (!seen.has(field.name))
                {
                    seen.set(field.name, field);
                }
            }
        }
        return [...seen.values()];
    }

    /** Makes BindingNames unique within the concept by suffixing a counter on collision. */
    private static Disambiguate(fields: UiField[]): void
    {
        const used = new Set<string>();
        for (let i = 0; i < fields.length; i++)
        {
            let binding = fields[i]!.BindingName;
            for (let n = 2; used.has(binding); n++)
            {
                binding = fields[i]!.BindingName + n;
            }
            used.add(binding);
            fields[i] = { ...fields[i]!, BindingName: binding };
        }
    }

    public static SafeIdentifier(raw: string): string
    {
        let id = raw.replace(ConceptUiModel.NonIdentifier, "");
        if (id.length === 0)
        {
            id = ConceptUiModel.EmptyFallback;
        }
        if (ConceptUiModel.LeadingDigit.test(id))
        {
            id = ConceptUiModel.DigitPrefix + id;
        }
        if (ConceptUiModel.Reserved.has(id))
        {
            id += ConceptUiModel.ReservedSuffix;
        }
        return id;
    }

    private static TypeOf(typeId: string): UiFieldType
    {
        const ts = scalarTsType(typeId);
        if (ts === ConceptUiModel.NumberType)
        {
            return UiFieldType.Number;
        }
        return ts === ConceptUiModel.BooleanType ? UiFieldType.Boolean : UiFieldType.String;
    }
}
