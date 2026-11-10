import {
    ConnectorResidency,
    MemberKind,
    PredicateKind,
    type CellValue,
    type IConnectorCapabilities,
    type IConnectorTransaction,
    type IDefinitionDescription,
    type IExternalConnector,
    type IFetchedRow,
    type IFetchPage,
    type IFetchRequest,
    type ISchemaDescription,
    type MemberInput,
    type ValueType,
} from '@pragmatic-tech-ai/graph';
import type { IServiceProvider } from '@pragmatic-tech-ai/todl-runtime';
import type { ExternalRecord, QueryComparison, QueryRequest } from '../../model-data/connector-plan.js';
import type { DataSourceAdapterCatalog } from '../../model-data/data-source-adapter-catalog.js';
import type { IDataSourceAdapter } from '../../model-data/data-source-adapter.js';
import { EngineBridgeError, EngineBridgeErrorCode } from '../EngineBridgeError.js';
import type { IExternalBinding, IExternalConnectorPlan } from './ExternalBinding.js';
import type { ExternalIdentity } from './ExternalIdentity.js';
import { ExternalValues } from './ExternalValues.js';
import { FetchTranslator } from './FetchTranslator.js';
import { ResumeToken } from './ResumeToken.js';

/** A field-mapped property member of a binding: its source field and engine type. */
interface IMappedProperty
{
    readonly Field: string;
    readonly Type: ValueType;
}

/** What a binding reads: its mapped properties and its mapped single-valued relationships (member → field). */
interface IBindingShape
{
    readonly Binding: IExternalBinding;
    readonly Properties: ReadonlyMap<string, IMappedProperty>;
    readonly Links: ReadonlyMap<string, string>;
}

/**
 * An engine External connector over one TODL data-source connector (rulings T5, T7, T8). Residency is External: the
 * source is the truth, and the engine fetches rows on demand and stores no property data. The connector serves the
 * bindings of its plan, each exactly for its (Model, Concept); a subtype of a bound concept reads as an empty page,
 * since a source holds exactly its bound concept. Push-down is advisory: the top-level conjuncts of the request
 * predicate that translate are sent as a Where and the rest are dropped, because the engine re-checks every row. Nothing
 * is cached: every Fetch reads the source (spec §5.2, §12). A source value that does not fit its member type fails the
 * fetch with ExternalRowInvalid; it never reads as null. The adapter is borrowed, not owned: the
 * DataSourceAdapterCatalog that opened it disposes it.
 */
export class DataSourceConnector implements IExternalConnector
{
    private static readonly DefaultLimit = 500;
    private static readonly MaxIdBytes = 400;
    private static readonly MemberSeparator = '.';
    private static readonly ErrNoKey = 'External row has no key: ';
    private static readonly ErrLongId = 'External public id exceeds the UTF-8 byte limit (';
    private static readonly ErrLongIdEnd = '): ';
    private static readonly ErrNoWrites = 'External writes are not available on connector ';
    private static readonly Empty: IFetchPage = Object.freeze({ Rows: Object.freeze([]) });

    public readonly Name: string;
    public readonly Residency = ConnectorResidency.External as const;
    public readonly Capabilities: IConnectorCapabilities = {
        KeyLookup: true,
        ReverseLookup: true,
        PushDown: new Set([
            PredicateKind.True, PredicateKind.Compare, PredicateKind.In, PredicateKind.IsNull, PredicateKind.Not, PredicateKind.And, PredicateKind.IdIn,
        ]),
    };

    private readonly definitions = new Map<string, IDefinitionDescription>();
    private readonly shapes = new Map<string, IBindingShape>();

    public constructor(
        plan: IExternalConnectorPlan,
        private readonly adapter: IDataSourceAdapter,
        private readonly identity: ExternalIdentity,
        description: ISchemaDescription,
    )
    {
        this.Name = plan.Name;
        for (const definition of description.Definitions)
        {
            this.definitions.set(definition.Name, definition);
        }
        for (const binding of plan.Bindings)
        {
            this.shapes.set(DataSourceConnector.ShapeKey(binding.Model, binding.Binding.Concept), this.Shape(binding));
        }
    }

    /** Opens (or reuses) the plan's adapter through the process-wide catalog and wraps it. */
    public static async Open(
        plan: IExternalConnectorPlan,
        adapters: DataSourceAdapterCatalog,
        services: IServiceProvider,
        identity: ExternalIdentity,
        description: ISchemaDescription,
    ): Promise<DataSourceConnector>
    {
        return new DataSourceConnector(plan, await adapters.Open(plan.Spec, services), identity, description);
    }

    /** The write side lands with DataSourceTransaction (Task 4). */
    public Begin(): Promise<IConnectorTransaction>
    {
        return Promise.reject(new EngineBridgeError(EngineBridgeErrorCode.UnsupportedExternalChange, DataSourceConnector.ErrNoWrites + this.Name));
    }

    public async Fetch(request: IFetchRequest): Promise<IFetchPage>
    {
        const shape = this.shapes.get(DataSourceConnector.ShapeKey(request.Model, request.Concept));
        if (shape === undefined)
        {
            return DataSourceConnector.Empty;
        }
        const terms: QueryComparison[] = [];
        if (request.Keys !== undefined)
        {
            const keys = FetchTranslator.Keys(shape.Binding, request.Keys, this.identity);
            if (keys === undefined)
            {
                return DataSourceConnector.Empty;
            }
            terms.push(keys);
        }
        if (request.Reverse !== undefined)
        {
            const field = shape.Links.get(request.Reverse.Relationship);
            if (field === undefined)
            {
                return DataSourceConnector.Empty;
            }
            terms.push(FetchTranslator.Reverse(shape.Binding, request.Reverse.Relationship, field, request.Reverse.Target, this.identity));
        }
        terms.push(...FetchTranslator.Where(shape.Binding, request.Predicate, this.identity)?.All ?? []);
        const query: QueryRequest = { Source: shape.Binding.Binding.Source, Fields: DataSourceConnector.Fields(shape, request) };
        if (terms.length > 0)
        {
            query.Where = { All: terms };
        }
        return this.Read(shape, request, query);
    }

    private async Read(shape: IBindingShape, request: IFetchRequest, query: QueryRequest): Promise<IFetchPage>
    {
        if (this.adapter.CanPage !== true || this.adapter.QueryPage === undefined)
        {
            return { Rows: this.Rows(shape, request, await this.adapter.Query(query)) };
        }
        query.OrderKey = shape.Binding.Binding.IdKey;
        const limit = request.Limit ?? DataSourceConnector.DefaultLimit;
        const page = request.Resume === undefined ? { Limit: limit } : { After: ResumeToken.Decode(request.Resume), Limit: limit };
        const slice = await this.adapter.QueryPage(query, page);
        const rows = this.Rows(shape, request, slice.Records);
        return slice.NextAfter === undefined ? { Rows: rows } : { Rows: rows, Resume: ResumeToken.Encode(slice.NextAfter) };
    }

    private Rows(shape: IBindingShape, request: IFetchRequest, records: readonly ExternalRecord[]): IFetchedRow[]
    {
        const members = request.Members.filter(m => shape.Properties.has(m));
        return records.map(record => this.Row(shape, members, record));
    }

    private Row(shape: IBindingShape, members: readonly string[], record: ExternalRecord): IFetchedRow
    {
        const binding = shape.Binding;
        const concept = binding.Binding.Concept;
        const key = record[binding.Binding.IdKey] ?? null;
        if (key === null)
        {
            throw new EngineBridgeError(EngineBridgeErrorCode.ExternalRowInvalid, DataSourceConnector.ErrNoKey + concept);
        }
        const publicId = this.identity.Mint(binding, String(key));
        if (Buffer.byteLength(publicId) > DataSourceConnector.MaxIdBytes)
        {
            throw new EngineBridgeError(EngineBridgeErrorCode.ExternalRowInvalid, DataSourceConnector.ErrLongId + DataSourceConnector.MaxIdBytes + DataSourceConnector.ErrLongIdEnd + concept);
        }
        const values = new Map<string, CellValue>();
        for (const member of members)
        {
            const property = shape.Properties.get(member)!;
            const subject = publicId + DataSourceConnector.MemberSeparator + member;
            values.set(member, ExternalValues.ToCell(property.Type, record[property.Field] ?? null, subject));
        }
        const links = new Map<string, readonly string[]>();
        for (const [relationship, field] of shape.Links)
        {
            const target = this.identity.LinkTarget(binding, relationship, record[field] ?? null);
            if (target !== undefined)
            {
                links.set(relationship, [target]);
            }
        }
        return { PublicId: publicId, Concept: concept, Values: values, Links: links };
    }

    /** IdKey, the field of each requested mapped property, and the field of each mapped relationship (T5). */
    private static Fields(shape: IBindingShape, request: IFetchRequest): string[]
    {
        const fields = new Set<string>([shape.Binding.Binding.IdKey]);
        for (const member of request.Members)
        {
            const property = shape.Properties.get(member);
            if (property !== undefined)
            {
                fields.add(property.Field);
            }
        }
        for (const field of shape.Links.values())
        {
            fields.add(field);
        }
        return [...fields];
    }

    /** The mapped members of `binding`: properties by type, single-valued relationships (many-valued are ignored, T5). */
    private Shape(binding: IExternalBinding): IBindingShape
    {
        const properties = new Map<string, IMappedProperty>();
        const links = new Map<string, string>();
        for (const [member, field] of Object.entries(binding.Binding.FieldMap))
        {
            const input = this.FindMember(binding.Binding.Concept, member, new Set<string>());
            if (input?.Kind === MemberKind.Property && input.Type !== undefined)
            {
                properties.set(member, { Field: field, Type: input.Type });
            }
            else if (input?.Kind === MemberKind.Relationship && input.Many !== true)
            {
                links.set(member, field);
            }
        }
        return { Binding: binding, Properties: properties, Links: links };
    }

    /** The member `name` declared on `concept` or anything it inherits or carries. */
    private FindMember(concept: string, name: string, seen: Set<string>): MemberInput | undefined
    {
        const definition = this.definitions.get(concept);
        if (definition === undefined || seen.has(concept))
        {
            return undefined;
        }
        seen.add(concept);
        const own = definition.Members.find(m => m.Name === name);
        if (own !== undefined)
        {
            return own;
        }
        const supers = definition.Parent === null ? definition.Aspects : [definition.Parent, ...definition.Aspects];
        for (const parent of supers)
        {
            const found = this.FindMember(parent, name, seen);
            if (found !== undefined)
            {
                return found;
            }
        }
        return undefined;
    }

    private static ShapeKey(model: string, concept: string): string
    {
        return JSON.stringify([model, concept]);
    }
}
