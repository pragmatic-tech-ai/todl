import { BindingTable, type ISchemaDescription } from '@pragmatic-tech-ai/graph';
import { ConnectorPlanEmitter } from '../../codegen/connector-plan-emitter.js';
import { fromJSON } from '../../compiler-services/emit/json.js';
import { MetaKind } from '../../compiler-services/model/kinds.js';
import { Domain, type IPackageDocumentSource, type PackageRef, type PackageSource, type ResolvedPackage } from '../../domain/domain.js';
import type { MetadataSnapshot } from '../../domain/metadata-snapshot.js';
import type { ConnectorSpec, ModelConnectorPlan } from '../../model-data/connector-plan.js';
import { ModelShardExtractor } from '../../model-data/model-shard-extractor.js';
import type { PackageDocument } from '../../publish/publish.js';
import type { IExternalBinding, IExternalConnectorPlan } from '../external/ExternalBinding.js';
import { ExternalIdentity } from '../external/ExternalIdentity.js';
import { MessageFormat } from '../MessageFormat.js';
import { SnapshotDescriber } from '../SnapshotDescriber.js';
import { DescribeDiagnosticCode, type IDescribeDiagnostic } from '../SnapshotDescription.js';
import { SystemNames } from '../system/SystemNames.js';
import { SystemPackage } from '../system/SystemPackage.js';
import { TodlNames } from '../TodlNames.js';
import { ConnectorPlanMerge } from './ConnectorPlanMerge.js';
import { EnvironmentCatalogError, EnvironmentCatalogErrorCode } from './EnvironmentCatalogError.js';
import { PackageVersionUnifier } from './PackageVersionUnifier.js';
import { UnifiedPackageSource } from './UnifiedPackageSource.js';

/** How a package set reached the environment. */
export enum DeliveryChannel
{
    /** An app deployed to the environment. */
    Deploy = 1,
    /** A promote set promoted into the environment. */
    Promote = 2,
}

/** One app's, or one promote set's, packages. */
export interface IPackageDelivery
{
    readonly Channel: DeliveryChannel;
    /** The app name or the promote set id. */
    readonly Name: string;
    readonly Packages: readonly Required<PackageRef>[];
}

export interface IComposeInput
{
    /** Every delivery the environment holds (the prospective set, to validate a deploy or promote). */
    readonly Deliveries: readonly IPackageDelivery[];
    /** The compiled packages (`StoragePackageSource` over the registry); nothing is compiled from source. */
    readonly Packages: PackageSource & IPackageDocumentSource;
}

/** One environment's runtime schema: the union of its deliveries plus `todl.system`. */
export interface IEnvironmentCatalog
{
    readonly Description: ISchemaDescription;
    /** The chosen package versions, sorted by model. */
    readonly Packages: readonly Required<PackageRef>[];
    readonly Snapshot: MetadataSnapshot;
    /** One plan per external connector the description binds, sorted by Name. */
    readonly Connectors: readonly IExternalConnectorPlan[];
    /** Public ids and keys over the described external bindings. */
    readonly Identity: ExternalIdentity;
    /** Concept full name → the package model id that declares it (EnvironmentNodePlacement's home models). */
    readonly HomeModels: ReadonlyMap<string, string>;
    /** The describer's diagnostics (none is ConflictingDefinition: that is an error). */
    readonly Diagnostics: readonly IDescribeDiagnostic[];
}

/** A package source that serves `todl.system` from SystemPackage and every other model from `inner`. */
class SystemFirstPackageSource implements PackageSource, IPackageDocumentSource
{
    private readonly system = new SystemPackage();

    public constructor(private readonly inner: PackageSource & IPackageDocumentSource) {}

    public resolve(ref: PackageRef): Promise<ResolvedPackage>
    {
        return ref.model === SystemNames.Model ? this.system.resolve(ref) : this.inner.resolve(ref);
    }

    public async versions(model: string): Promise<readonly string[]>
    {
        return model === SystemNames.Model ? this.system.versions(model) : ((await this.inner.versions?.(model)) ?? []);
    }

    public Document(ref: Required<PackageRef>): Promise<PackageDocument>
    {
        return ref.model === SystemNames.Model ? this.system.Document(ref) : this.inner.Document(ref);
    }
}

/**
 * Composes an environment's runtime catalog from its deliveries (rulings T2, T3, T4, T11, T12). Pure: it reads compiled
 * packages and writes nothing, so a host runs it on a prospective delivery set to validate a deploy or promote, and
 * re-runs it over the current deliveries after one (the description then upgrades the engine, spec §4.3).
 *
 * In order: unify the versions over the deliveries plus `todl.system` (PackageVersionUnifier); load each chosen package
 * into a Domain over UnifiedPackageSource; build one connector plan per package (`Model` its model id) from its
 * document's models; merge the plans (ConnectorPlanMerge); describe with engine storage as the default connector and
 * external bindings emitted, rejecting a ConflictingDefinition diagnostic; build ExternalIdentity over the described
 * external bindings.
 */
export class EnvironmentCatalogComposer
{
    private static readonly ConflictingMessage = 'the deliveries cannot share one environment: {0}';
    private static readonly SystemDelivery = SystemNames.Model;

    private constructor() {}

    public static async Compose(input: IComposeInput): Promise<IEnvironmentCatalog>
    {
        const source = new SystemFirstPackageSource(input.Packages);
        const system: IPackageDelivery = { Channel: DeliveryChannel.Deploy, Name: EnvironmentCatalogComposer.SystemDelivery, Packages: [SystemPackage.Ref] };
        const unified = await PackageVersionUnifier.Resolve([...input.Deliveries, system], source);
        const packages = [...unified.Chosen].map(([model, version]) => ({ model, version }));
        const domain = new Domain(new UnifiedPackageSource(source, unified.Chosen));
        const documents = new Map<string, PackageDocument>();
        for (const ref of packages)
        {
            await domain.load(ref);
            documents.set(ref.model, await source.Document(ref));
        }
        const merged = ConnectorPlanMerge.Merge(packages.map((ref) => EnvironmentCatalogComposer.PlanOf(ref, documents.get(ref.model)!)), unified.Deliveries);
        const described = SnapshotDescriber.Describe(domain.Snapshot, {
            DefaultConnector: BindingTable.EngineStorage,
            ConnectorPlans: merged.Plans,
            EmitExternalBindings: true,
        });
        const conflict = described.Diagnostics.find((d) => d.Code === DescribeDiagnosticCode.ConflictingDefinition);
        if (conflict !== undefined)
        {
            const declarers = [...documents].filter(([, doc]) => EnvironmentCatalogComposer.Declares(doc, conflict.Subject)).map(([model]) => model);
            const deliveries = [...new Set(declarers.flatMap((m) => unified.Deliveries.get(m) ?? []))].sort();
            throw new EnvironmentCatalogError(EnvironmentCatalogErrorCode.ConflictingDefinition, conflict.Subject, deliveries,
                MessageFormat.Format(EnvironmentCatalogComposer.ConflictingMessage, conflict.Message));
        }
        const description = described.Description;
        const external = EnvironmentCatalogComposer.Described(description, merged.External);
        return {
            Description: description,
            Packages: packages,
            Snapshot: domain.Snapshot,
            Connectors: EnvironmentCatalogComposer.Connectors(external, merged.Specs),
            Identity: new ExternalIdentity(description, external),
            HomeModels: EnvironmentCatalogComposer.HomeModels(documents),
            Diagnostics: described.Diagnostics,
        };
    }

    /** The package's connector plan: every model of its document merged, under the package model id. */
    private static PlanOf(ref: Required<PackageRef>, doc: PackageDocument): ModelConnectorPlan
    {
        const plan: ModelConnectorPlan = { Model: ref.model, Version: ref.version, Connectors: [], Bindings: [] };
        const repository = fromJSON(doc);
        for (const model of ModelShardExtractor.ModelsOf(doc))
        {
            const part = ConnectorPlanEmitter.PlanFor(repository, model);
            if (part === undefined) continue;
            plan.Connectors.push(...part.Connectors);
            plan.Bindings.push(...part.Bindings);
        }
        return plan;
    }

    /** The external bindings the description kept (the describer drops invalid and duplicate ones), in its order. */
    private static Described(description: ISchemaDescription, candidates: readonly IExternalBinding[]): IExternalBinding[]
    {
        const out: IExternalBinding[] = [];
        for (const bound of description.Bindings)
        {
            if (bound.Connector === BindingTable.EngineStorage || bound.Connector === TodlNames.FileConnector) continue;
            const binding = candidates.find((c) => c.Model === bound.Model && c.Binding.Concept === bound.Concept && c.Connector === bound.Connector);
            if (binding !== undefined) out.push(binding);
        }
        return out;
    }

    /** One plan per external connector the bindings use, sorted by name. */
    private static Connectors(bindings: readonly IExternalBinding[], specs: ReadonlyMap<string, ConnectorSpec>): IExternalConnectorPlan[]
    {
        const out: IExternalConnectorPlan[] = [];
        for (const name of [...new Set(bindings.map((b) => b.Connector))].sort())
        {
            const spec = specs.get(name);
            if (spec !== undefined) out.push({ Name: name, Spec: spec, Bindings: bindings.filter((b) => b.Connector === name) });
        }
        return out;
    }

    /** Concept → the first package (by model) whose own document declares it. */
    private static HomeModels(documents: ReadonlyMap<string, PackageDocument>): Map<string, string>
    {
        const homes = new Map<string, string>();
        for (const [model, doc] of documents)
        {
            for (const node of doc.nodes)
            {
                if (node.metaKind === MetaKind.Concept && !homes.has(node.id)) homes.set(node.id, model);
            }
        }
        return homes;
    }

    private static Declares(doc: PackageDocument, fullName: string): boolean
    {
        return doc.nodes.some((n) => n.id === fullName && (n.metaKind === MetaKind.Concept || n.metaKind === MetaKind.Aspect));
    }
}
