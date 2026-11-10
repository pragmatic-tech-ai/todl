import type { Cypher } from '@pragmatic-tech-ai/graph';
import type { CypherResultDto, CypherValueDto } from '../graph-api/wire/index.js';
import type { MetadataSnapshot } from '../domain/metadata-snapshot.js';
import { GraphQuery } from '../graph-api/graph-query-engine.js';
import type { FieldSnapshot, MirrorSnapshot } from '../graph-api/snapshot.js';
import { Cardinality, MetaKind } from '../manifest/enums.js';
import type { Scalar } from '../manifest/logical.js';
import type { FieldInfo, TermInfo, TypeInfo } from '../manifest/reflection/reflection.js';
import { TodlNames } from './TodlNames.js';

type EngineCell = Cypher.CypherValueDto;

type EngineNode = Cypher.NodeCellDto['$node'];

/**
 * The members an access scope hides on a concept's nodes, as the engine decides them (a scoped `GraphReader`
 * satisfies it; pass a reader opened under the result's own scope, or one under `AccessScope.System` for an
 * unscoped result). Only consulted for fields the engine holds as relationships: a node cell cannot tell a
 * hidden relationship from an empty one, while a hidden property is simply absent from the cell's properties.
 */
export interface IHiddenMembers
{
    HiddenMembers(concept: string): ReadonlySet<string>;
}

/**
 * Maps the graph engine's neutral Cypher result cells onto TODL's wire shape, so endpoints keep their format when
 * they move onto the engine. A node cell becomes a `MirrorSnapshot` exactly as `Snapshot.of` would project the same
 * instance: the display label falls back from the engine's explicit `label` the way `Snapshot.LabelOf` does, fields
 * carry the definition and value origins, and refs come from the node's links (plus a single-card taxonomy field's
 * term, which the engine holds as a String property but TODL holds as a ref). Every other cell passes through,
 * recursing into lists and maps so nested nodes are mapped too.
 *
 * A member the reader's scope hides is left out of the node's `fields` and `refs` entirely, as the masked mirror did:
 * a property field absent from the engine cell's properties (the engine emits every visible property, null when
 * unset, and omits hidden ones), and a relationship-held field (a concept or aspect typed field, a many-valued
 * taxonomy field) that `hidden` reports (required, so a hidden link field can never fail open). Hidden relationships carry no links, so they have no refs key either.
 */
export class EngineCellMapper
{
    private static readonly SelfOrigin = 'self';
    private static readonly NodeKey = '$node';
    private static readonly MapKey = '$map';
    private static readonly IntKey = '$int';
    private static readonly NameField = 'name';
    private static readonly NumericBuiltins: ReadonlySet<string> = new Set(['integer', 'number']);

    private readonly query: GraphQuery;
    private readonly taxonomyNames = new Set<string>();

    constructor(private readonly snapshot: MetadataSnapshot)
    {
        this.query = new GraphQuery(snapshot);
        for (const manifest of snapshot.manifests)
        {
            for (const taxonomy of manifest.taxonomies())
            {
                this.taxonomyNames.add(taxonomy.name);
            }
        }
    }

    /** `hidden` is required: without it a hidden relationship-held field could not be told from an empty one. */
    public MapResult(dto: Cypher.CypherResultDto, hidden: IHiddenMembers): CypherResultDto
    {
        const mapped: CypherResultDto = {
            Columns: [...dto.Columns],
            Rows: dto.Rows.map((row) => row.map((cell) => this.MapCell(cell, hidden))),
            Truncated: dto.Truncated,
            HasMore: dto.HasMore,
        };
        if (dto.Stats !== undefined)
        {
            mapped.Stats = dto.Stats;
        }
        return mapped;
    }

    private MapCell(cell: EngineCell, hidden: IHiddenMembers): CypherValueDto
    {
        if (cell === null || typeof cell !== 'object')
        {
            return cell;
        }
        if (Array.isArray(cell))
        {
            return cell.map((item) => this.MapCell(item, hidden));
        }
        const record = cell as Record<string, EngineCell>;
        const keys = Object.keys(record);
        if (keys.length === 1 && keys[0] === EngineCellMapper.NodeKey)
        {
            return { $node: this.MapNode(record[EngineCellMapper.NodeKey] as unknown as EngineNode, hidden) };
        }
        if (keys.length === 1 && keys[0] === EngineCellMapper.MapKey)
        {
            // An escaped map: its entries are data (a key spelled `$node` is not a node cell), only its values recurse.
            return { [EngineCellMapper.MapKey]: this.MapEntries(record[EngineCellMapper.MapKey] as unknown as Record<string, EngineCell>, hidden) };
        }
        return this.MapEntries(record, hidden);
    }

    private MapEntries(record: Record<string, EngineCell>, hidden: IHiddenMembers): Record<string, CypherValueDto>
    {
        const entries: Record<string, CypherValueDto> = {};
        for (const key of Object.keys(record))
        {
            entries[key] = this.MapCell(record[key]!, hidden);
        }
        return entries;
    }

    private MapNode(node: EngineNode, hidden: IHiddenMembers): MirrorSnapshot
    {
        const type = this.snapshot.getType(node.concept);
        const owner = this.snapshot.ownerOf(node.concept);
        const classId = node.properties[TodlNames.Class];
        const term = typeof classId === 'string' ? owner?.getTerm(classId) : undefined;
        const fields: Record<string, FieldSnapshot> = {};
        const refs: Record<string, string[]> = {};
        for (const [relationship, targets] of Object.entries(node.links))
        {
            refs[relationship] = [...targets];
        }
        const withheld = hidden.HiddenMembers(node.concept);
        for (const field of type?.getFields() ?? [])
        {
            if (this.Withheld(node, field, withheld)) continue;
            const cell = node.properties[field.name];
            const taxonomy = this.IsTaxonomy(field);
            const value = taxonomy ? undefined : this.FieldValue(field, cell);
            fields[field.name] = {
                value,
                definitionOrigin: field.declaringType.fullName,
                valueOrigin: EngineCellMapper.ValueOrigin(term, field, value),
            };
            if (taxonomy && typeof cell === 'string')
            {
                refs[field.name] = [cell];
            }
        }
        const snapshot: MirrorSnapshot = {
            id: node.id,
            concept: node.concept,
            label: EngineCellMapper.LabelOf(node, fields),
            fields,
            refs,
        };
        if (term !== undefined)
        {
            snapshot.class = term.id;
        }
        const iconKey = this.query.IconKey(node.concept);
        if (iconKey !== undefined)
        {
            snapshot.iconKey = iconKey;
        }
        return snapshot;
    }

    /** True when the scope hides the field (see the class comment): it then has no `fields` entry. */
    private Withheld(node: EngineNode, field: FieldInfo, withheld: ReadonlySet<string>): boolean
    {
        if (this.IsRelationshipHeld(field)) return withheld.has(field.name);
        return !Object.prototype.hasOwnProperty.call(node.properties, field.name);
    }

    /** The engine holds the field as a relationship (SnapshotDescriber's rule): a concept or aspect type, or many terms. */
    private IsRelationshipHeld(field: FieldInfo): boolean
    {
        const kind = field.fieldType?.kind;
        if (kind === MetaKind.Concept || kind === MetaKind.Aspect) return true;
        return this.IsTaxonomy(field) && (field.cardinality === Cardinality.Many || field.cardinality === Cardinality.OneOrMore);
    }

    /** Display label: the declared `label` field, else `name`, else the id (Snapshot.LabelOf's rule). */
    private static LabelOf(node: EngineNode, fields: Record<string, FieldSnapshot>): string
    {
        const value = fields[TodlNames.Label]?.value ?? fields[EngineCellMapper.NameField]?.value ?? EngineCellMapper.ToScalar(node.properties[TodlNames.Label]);
        return value !== undefined ? String(value) : node.id;
    }

    /** The term that fixes the field's value on this instance, or "self" (Snapshot.of's Axis-2 rule). */
    private static ValueOrigin(term: TermInfo | undefined, field: FieldInfo, value: Scalar | undefined): string
    {
        const fixer = term?.findFixing(field);
        if (fixer === undefined)
        {
            return EngineCellMapper.SelfOrigin;
        }
        const fixed = fixer.getFixedValue(field);
        return fixed !== undefined && value !== undefined && String(fixed) === String(value) ? fixer.id : EngineCellMapper.SelfOrigin;
    }

    /**
     * The field's TODL value. TODL keeps numeric literals as decimal strings, while the engine holds Int64/Float64
     * numbers, so a numeric field's engine number is rendered back as its decimal string. The rendering is lossy:
     * the engine keeps no literal text, so a non-canonical literal such as "2.0" or "1.50" comes back as "2" or
     * "1.5", and a very large or small Float64 as JS formats it (exponent forms such as "1e+21").
     */
    private FieldValue(field: FieldInfo, cell: EngineCell | undefined): Scalar | undefined
    {
        const value = EngineCellMapper.ToScalar(cell);
        return typeof value === 'number' && EngineCellMapper.IsNumeric(field.fieldType) ? String(value) : value;
    }

    /** True when the type's base chain ends at the `integer` or `number` builtin. */
    private static IsNumeric(type: TypeInfo | undefined): boolean
    {
        const seen = new Set<string>();
        let current = type;
        while (current !== undefined && !seen.has(current.fullName))
        {
            if (EngineCellMapper.NumericBuiltins.has(current.fullName))
            {
                return true;
            }
            seen.add(current.fullName);
            current = current.baseType;
        }
        return false;
    }

    private IsTaxonomy(field: FieldInfo): boolean
    {
        const type: TypeInfo | undefined = field.fieldType;
        return type !== undefined && (type.kind === MetaKind.Taxonomy || (type.kind === MetaKind.Primitive && this.taxonomyNames.has(type.fullName)));
    }

    /** A TODL scalar from an engine property cell; undefined when the property is unset or not a scalar. */
    private static ToScalar(cell: EngineCell | undefined): Scalar | undefined
    {
        if (typeof cell === 'string' || typeof cell === 'number' || typeof cell === 'boolean')
        {
            return cell;
        }
        if (cell !== null && typeof cell === 'object' && !Array.isArray(cell))
        {
            const big = (cell as Record<string, unknown>)[EngineCellMapper.IntKey];
            return typeof big === 'string' ? big : undefined;
        }
        return undefined;
    }
}
