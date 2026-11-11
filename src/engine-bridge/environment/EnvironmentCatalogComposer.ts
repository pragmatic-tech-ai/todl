import { BindingTable, type ISchemaDescription } from '@pragmatic-tech-ai/graph';
import { ConnectorPlanEmitter } from '../../codegen/connector-plan-emitter.js';
import { ConnectorDeclaration } from '../../compiler-services/connectors/connector-declaration.js';
import { fromJSON, type JsonNode } from '../../compiler-services/emit/json.js';
import { Builder } from '../../compiler-services/model/builder.js';
import { MetaKind } from '../../compiler-services/model/kinds.js';
import { Domain, type IPackageDocumentSource, type PackageRef, type PackageSource, type ResolvedPackage } from '../../domain/domain.js';
import type { MetadataSnapshot } from '../../domain/metadata-snapshot.js';
import type { ModelConnectorPlan } from '../../model-data/connector-plan.js';
import { ModelShardExtractor } from '../../model-data/model-shard-extractor.js';
import type { PackageDocument } from '../../publish/publish.js';
import type { IExternalConnectorPlan } from '../external/ExternalBinding.js';
import { ExternalIdentity } from '../external/ExternalIdentity.js';
import { MessageFormat } from '../MessageFormat.js';
import { DescribeDiagnosticCode, type IDescribeDiagnostic } from '../SnapshotDescription.js';
import { SystemNames } from '../system/SystemNames.js';
import { SystemPackage } from '../system/SystemPackage.js';
import { ConnectorPlanMerge } from './ConnectorPlanMerge.js';
import { ExternalCatalogDescriber } from './ExternalCatalogDescriber.js';
import { DeliveryChannel, type IPackageDelivery } from './PackageDelivery.js';
import { EnvironmentCatalogError, EnvironmentCatalogErrorCode } from './EnvironmentCatalogError.js';
import { PackageVersionUnifier } from './PackageVersionUnifier.js';
import { UnifiedPackageSource } from './UnifiedPackageSource.js';

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

    public constructor(private readonly inner: PackageSource & IPackageDocumentSource)
    {
    }

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
 * Composes an environment's runtime catalog from its deliveries (rulings T2, T3, T4, T11, T12, P12). Pure: it reads compiled
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
    private static readonly ConflictingMessage = 'the deliveries cannot share one environment{0}: {1}';
    private static readonly ConflictingConnectorMessage = 'datasource "{0}" is declared differently by packages "{1}" and "{2}"{3}, and package "{4}" sees both';
    private static readonly ConflictingOwnConnectorMessage = 'package "{1}" declares datasource "{0}" and its dependency "{2}" declares it differently{3}';
    private static readonly SystemDelivery = SystemNames.Model;

    private constructor()
    {
    }

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
        const plans = packages.map((ref) => EnvironmentCatalogComposer.PlanOf(ref, documents, unified.Deliveries));
        const catalog = ExternalCatalogDescriber.Describe(domain.Snapshot, plans, {
            DefaultConnector: BindingTable.EngineStorage,
            LocalConnector: BindingTable.EngineStorage,
            Deliveries: unified.Deliveries,
        });
        const conflict = catalog.Diagnostics.find((d) => d.Code === DescribeDiagnosticCode.ConflictingDefinition);
        if (conflict !== undefined)
        {
            const declarers = [...documents].filter(([, doc]) => EnvironmentCatalogComposer.Declares(doc, conflict.Subject)).map(([model]) => model);
            const deliveries = [...new Set(declarers.flatMap((m) => unified.Deliveries.get(m) ?? []))].sort();
            throw new EnvironmentCatalogError(EnvironmentCatalogErrorCode.ConflictingDefinition, conflict.Subject, deliveries,
                MessageFormat.Format(EnvironmentCatalogComposer.ConflictingMessage, EnvironmentCatalogError.DeliveredBy(deliveries), conflict.Message));
        }
        return {
            Description: catalog.Description,
            Packages: packages,
            Snapshot: domain.Snapshot,
            Connectors: catalog.Connectors,
            Identity: catalog.Identity,
            HomeModels: EnvironmentCatalogComposer.HomeModels(documents),
            Diagnostics: catalog.Diagnostics,
        };
    }

    /**
     * The package's connector plan: every model of its document merged, under the package model id. Ruling P12: a model
     * may `connect` a datasource declared in a dependency, which the own-only document does not hold, so the plan is
     * built over the document plus the datasource nodes of its (unified) dependency closure. A population whose connector
     * is still not visible is UnknownConnector (PlanFor would skip it, and the concept would fall to engine storage).
     */
    private static PlanOf(ref: Required<PackageRef>, documents: ReadonlyMap<string, PackageDocument>, deliveriesOf: ReadonlyMap<string, readonly string[]>): ModelConnectorPlan
    {
        const doc = documents.get(ref.model)!;
        const deliveries = deliveriesOf.get(ref.model) ?? [];
        const visible = EnvironmentCatalogComposer.WithDependencyConnectors(ref.model, documents, deliveriesOf);
        const connectors = new Set(visible.nodes.filter((n) => n.metaKind === MetaKind.Connector).map((n) => n.id));
        for (const node of doc.nodes)
        {
            if (node.metaKind !== MetaKind.Population) continue;
            const connector = String(node.attrs[Builder.BindingConnectorAttr]);
            if (!connectors.has(connector))
            {
                throw new EnvironmentCatalogError(EnvironmentCatalogErrorCode.UnknownConnector, connector, deliveries,
                    MessageFormat.Format(ConnectorPlanMerge.UnknownMessage, ref.model, EnvironmentCatalogError.DeliveredBy(deliveries),
                        String(node.attrs[Builder.BindingConceptAttr]), connector));
            }
        }
        const plan: ModelConnectorPlan = { Model: ref.model, Version: ref.version, Connectors: [], Bindings: [] };
        const repository = fromJSON(visible);
        for (const model of ModelShardExtractor.ModelsOf(doc))
        {
            const part = ConnectorPlanEmitter.PlanFor(repository, model);
            if (part === undefined) continue;
            plan.Connectors.push(...part.Connectors);
            plan.Bindings.push(...part.Bindings);
        }
        return plan;
    }

    /**
     * The document of package `model` plus every datasource node of the packages it depends on, transitively, at their
     * chosen versions. Datasource ids are namespace-scoped, so two of those packages may declare one id: identical
     * declarations are one connector, different ones are ConflictingConnector (never first-wins).
     */
    private static WithDependencyConnectors(model: string, documents: ReadonlyMap<string, PackageDocument>, deliveriesOf: ReadonlyMap<string, readonly string[]>): PackageDocument
    {
        const doc = documents.get(model)!;
        const nodes = [...doc.nodes];
        const declarers = new Map<string, { readonly Node: JsonNode; readonly Model: string }>();
        for (const node of nodes)
        {
            if (node.metaKind === MetaKind.Connector) declarers.set(node.id, { Node: node, Model: model });
        }
        const seen = new Set<string>();
        const queue = (doc.dependencies ?? []).map((d) => d.id);
        while (queue.length > 0)
        {
            const next = queue.shift()!;
            const dependency = documents.get(next);
            if (seen.has(next) || dependency === undefined) continue;
            seen.add(next);
            for (const node of dependency.nodes)
            {
                if (node.metaKind !== MetaKind.Connector) continue;
                const first = declarers.get(node.id);
                if (first === undefined)
                {
                    declarers.set(node.id, { Node: node, Model: next });
                    nodes.push(node);
                }
                else if (!ConnectorDeclaration.Same(first.Node.attrs, node.attrs))
                {
                    const deliveries = [...new Set([first.Model, next].flatMap((m) => deliveriesOf.get(m) ?? []))].sort();
                    throw new EnvironmentCatalogError(EnvironmentCatalogErrorCode.ConflictingConnector, node.id, deliveries,
                        first.Model === model
                            ? MessageFormat.Format(EnvironmentCatalogComposer.ConflictingOwnConnectorMessage, node.id, model, next, EnvironmentCatalogError.DeliveredBy(deliveries))
                            : MessageFormat.Format(EnvironmentCatalogComposer.ConflictingConnectorMessage, node.id, first.Model, next,
                                EnvironmentCatalogError.DeliveredBy(deliveries), model));
                }
            }
            queue.push(...(dependency.dependencies ?? []).map((d) => d.id));
        }
        return { ...doc, nodes };
    }

    /**
     * Concept → its home package: the first package, in sorted model-id order (the order `documents` holds the chosen
     * packages in), whose own document declares the concept. When two packages that do not depend on each other declare
     * one concept identically (ruling T12), the home is the lower model id. Should that package leave the environment,
     * the concept moves to the remaining declarer at the next Compose, while nodes created before keep the owner they
     * were given.
     */
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
