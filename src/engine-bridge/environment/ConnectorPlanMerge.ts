import { BindingTable } from '@pragmatic-tech-ai/graph';
import { DataSourceKind, type ConnectorBinding, type ConnectorSpec, type ModelConnectorPlan } from '../../model-data/connector-plan.js';
import type { IExternalBinding } from '../external/ExternalBinding.js';
import { ExternalIdentity } from '../external/ExternalIdentity.js';
import { MessageFormat } from '../MessageFormat.js';
import { TodlNames } from '../TodlNames.js';
import { EnvironmentCatalogError, EnvironmentCatalogErrorCode } from './EnvironmentCatalogError.js';

/** The connector plans of an environment after merging (rulings T2, T3, T4). */
export interface IMergedConnectors
{
    /** The input plans, in order, with every binding's Connector rewritten to its engine name or engine storage (T3). */
    readonly Plans: readonly ModelConnectorPlan[];
    /** Every binding to an external connector, with its engine name and the binding as authored. */
    readonly External: readonly IExternalBinding[];
    /** The external connector specs by engine name (builtin-kind specs are engine storage, not listed). */
    readonly Specs: ReadonlyMap<string, ConnectorSpec>;
}

/**
 * Merges the connector plans of an environment's packages (one plan per package, `Model` the package model id).
 * Specs merge by engine name `Id ?? Name` (T2): a reserved name is ReservedConnectorName, and two specs of one name
 * that are not the same spec are ConflictingConnector. A binding links to its spec by `ConnectorId ?? Connector`;
 * one to a builtin-kind spec or to `todl-file` is routed to `localConnector` (default engine storage, R107; a spec
 * named like `localConnector` is ReservedConnectorName too), every other one takes its engine name (T3), and
 * one whose spec is absent is UnknownConnector (ruling P12: a binding never falls back to engine storage silently). Two
 * external bindings of different models whose public ids share one minted prefix (`Concept#Connector.Source#`) are
 * DuplicateExternalSource (T4).
 * Errors name the deliveries that brought the packages in (`deliveries`: package model → delivery names).
 */
export class ConnectorPlanMerge
{
    private static readonly ReservedNames: ReadonlySet<string> = new Set([BindingTable.EngineStorage, TodlNames.FileConnector]);
    private static readonly ReservedMessage = 'connector "{0}" of package "{1}"{2} uses a reserved connector name';
    private static readonly ConflictMessage = 'connector "{0}" is declared differently by packages "{1}" and "{2}"{3}';
    private static readonly DuplicateSourceMessage = 'packages "{0}" and "{1}"{2} both bind "{3}" to source "{4}" of connector "{5}"; their ids would collide';
    /** The one UnknownConnector message (EnvironmentCatalogComposer raises it too): package, deliveries, concept, connector. */
    public static readonly UnknownMessage = 'package "{0}"{1} populates "{2}" from connector "{3}", which neither it nor its dependencies declare';
    private static readonly SourceSubject = '{0}#{1}.{2}';

    /** Engine name → the spec and the package that first declared it. */
    private readonly specs = new Map<string, { readonly Spec: ConnectorSpec; readonly Model: string }>();
    /** Minted public-id prefix (concept, connector, source) → the package model whose binding holds it. */
    private readonly sources = new Map<string, string>();
    private readonly external: IExternalBinding[] = [];

    private constructor(private readonly deliveries: ReadonlyMap<string, readonly string[]>, private readonly localConnector: string)
    {
    }

    public static Merge(plans: readonly ModelConnectorPlan[], deliveries: ReadonlyMap<string, readonly string[]>, localConnector: string = BindingTable.EngineStorage): IMergedConnectors
    {
        const merge = new ConnectorPlanMerge(deliveries, localConnector);
        for (const plan of plans)
        {
            for (const spec of plan.Connectors)
            {
                merge.AddSpec(plan.Model, spec);
            }
        }
        const rewritten = plans.map((plan) => ({ ...plan, Bindings: plan.Bindings.map((b) => merge.Rewrite(plan.Model, b)) }));
        const specs = new Map<string, ConnectorSpec>();
        for (const [name, entry] of merge.specs)
        {
            if (entry.Spec.Kind !== DataSourceKind.Builtin) specs.set(name, entry.Spec);
        }
        return { Plans: rewritten, External: merge.external, Specs: specs };
    }

    /** Two specs are the same connector when every authored attribute agrees (server AppConnectorPlan.SameSpec). */
    public static SameSpec(a: ConnectorSpec, b: ConnectorSpec): boolean
    {
        return a.Name === b.Name && a.Kind === b.Kind && a.Connection === b.Connection && a.Secret === b.Secret
            && a.Provider === b.Provider && ConnectorPlanMerge.SameConfig(a.Config, b.Config);
    }

    private static SameConfig(a: Record<string, string>, b: Record<string, string>): boolean
    {
        const keys = Object.keys(a).sort();
        const other = Object.keys(b).sort();
        return keys.length === other.length && keys.every((key, i) => key === other[i] && a[key] === b[key]);
    }

    private AddSpec(model: string, spec: ConnectorSpec): void
    {
        const name = spec.Id ?? spec.Name;
        if (ConnectorPlanMerge.ReservedNames.has(name) || name === this.localConnector)
        {
            const deliveries = this.DeliveriesOf(model);
            throw new EnvironmentCatalogError(EnvironmentCatalogErrorCode.ReservedConnectorName, name, deliveries,
                MessageFormat.Format(ConnectorPlanMerge.ReservedMessage, name, model, EnvironmentCatalogError.DeliveredBy(deliveries)));
        }
        const existing = this.specs.get(name);
        if (existing === undefined)
        {
            this.specs.set(name, { Spec: spec, Model: model });
            return;
        }
        if (!ConnectorPlanMerge.SameSpec(existing.Spec, spec))
        {
            const deliveries = this.DeliveriesOf(existing.Model, model);
            throw new EnvironmentCatalogError(EnvironmentCatalogErrorCode.ConflictingConnector, name, deliveries,
                MessageFormat.Format(ConnectorPlanMerge.ConflictMessage, name, existing.Model, model, EnvironmentCatalogError.DeliveredBy(deliveries)));
        }
    }

    private Rewrite(model: string, binding: ConnectorBinding): ConnectorBinding
    {
        const name = binding.ConnectorId ?? binding.Connector;
        const spec = this.specs.get(name)?.Spec;
        if (spec?.Kind === DataSourceKind.Builtin || (spec === undefined && name === TodlNames.FileConnector))
        {
            return { ...binding, Connector: this.localConnector };
        }
        if (spec === undefined)
        {
            // Defensive: EnvironmentCatalogComposer.PlanOf already rejects a population whose connector is not visible, so
            // a composed plan never reaches here; a direct caller of Merge still gets the same error, never a fallback.
            const deliveries = this.DeliveriesOf(model);
            throw new EnvironmentCatalogError(EnvironmentCatalogErrorCode.UnknownConnector, name, deliveries,
                MessageFormat.Format(ConnectorPlanMerge.UnknownMessage, model, EnvironmentCatalogError.DeliveredBy(deliveries), binding.Concept, name));
        }
        const external: IExternalBinding = { Model: model, Connector: name, Binding: binding };
        // Keyed by the minted prefix itself, so two different tuples that mint one prefix (a `.` in a name) collide too.
        const key = ExternalIdentity.Prefix(external);
        const holder = this.sources.get(key);
        if (holder !== undefined && holder !== model)
        {
            const deliveries = this.DeliveriesOf(holder, model);
            throw new EnvironmentCatalogError(EnvironmentCatalogErrorCode.DuplicateExternalSource,
                MessageFormat.Format(ConnectorPlanMerge.SourceSubject, binding.Concept, name, binding.Source), deliveries,
                MessageFormat.Format(ConnectorPlanMerge.DuplicateSourceMessage, holder, model, EnvironmentCatalogError.DeliveredBy(deliveries), binding.Concept, binding.Source, name));
        }
        this.sources.set(key, model);
        this.external.push(external);
        return { ...binding, Connector: name };
    }

    private DeliveriesOf(...models: string[]): string[]
    {
        return [...new Set(models.flatMap((m) => this.deliveries.get(m) ?? []))].sort();
    }
}
