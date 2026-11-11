import { BindingTable, type ISchemaDescription } from '@pragmatic-tech-ai/graph';
import type { MetadataSnapshot } from '../../domain/metadata-snapshot.js';
import type { ConnectorBinding, ConnectorSpec, ModelConnectorPlan } from '../../model-data/connector-plan.js';
import type { IExternalBinding, IExternalConnectorPlan } from '../external/ExternalBinding.js';
import { ExternalIdentity } from '../external/ExternalIdentity.js';
import { MessageFormat } from '../MessageFormat.js';
import { SnapshotDescriber } from '../SnapshotDescriber.js';
import { DescribeDiagnosticCode, type IDescribeDiagnostic } from '../SnapshotDescription.js';
import { TodlNames } from '../TodlNames.js';
import { ConnectorPlanMerge } from './ConnectorPlanMerge.js';
import { EnvironmentCatalogError, EnvironmentCatalogErrorCode } from './EnvironmentCatalogError.js';

export interface IExternalCatalogOptions
{
    readonly DefaultConnector: string;
    /** Where builtin and `todl-file` bindings are routed (R107). */
    readonly LocalConnector: string;
    /** Package model -> delivery names, for error messages; default empty. */
    readonly Deliveries?: ReadonlyMap<string, readonly string[]>;
}

export interface IExternalCatalog
{
    readonly Description: ISchemaDescription;
    /** The concepts served by an external connector. */
    readonly External: ReadonlySet<string>;
    /** One plan per external connector the description binds, sorted by Name. */
    readonly Connectors: readonly IExternalConnectorPlan[];
    /** Public ids and keys over the described external bindings. */
    readonly Identity: ExternalIdentity;
    /** The describer's diagnostics (ConflictingDefinition is left to the caller). */
    readonly Diagnostics: readonly IDescribeDiagnostic[];
}

/**
 * The shared merge -> describe -> identity path: merges per-package connector plans (ConnectorPlanMerge), rejects a
 * package binding one concept twice differently (DuplicateBinding), describes the snapshot with external bindings
 * emitted, rejects a binding the description cannot take (InvalidBinding), and builds the per-connector plans and
 * ExternalIdentity over the bindings the description kept. A ConflictingDefinition diagnostic is returned, not thrown:
 * the caller owns it (it needs the package documents), and it is reported before InvalidBinding.
 */
export class ExternalCatalogDescriber
{
    private static readonly DuplicateBindingMessage = 'package "{0}"{1} populates "{2}" from both {3} and {4}; one concept has one source per package';
    private static readonly InvalidBindingMessage = 'package "{0}"{1} has a binding the environment cannot describe: {2}';
    private static readonly BindingTarget = 'connector "{0}" source "{1}"';
    private static readonly ListSeparator = ', ';
    private static readonly KeySeparator = '#';

    private constructor()
    {
    }

    public static Describe(snapshot: MetadataSnapshot, plans: readonly ModelConnectorPlan[], options: IExternalCatalogOptions): IExternalCatalog
    {
        const deliveriesOf = options.Deliveries ?? new Map<string, readonly string[]>();
        const merged = ConnectorPlanMerge.Merge(plans, deliveriesOf, options.LocalConnector);
        ExternalCatalogDescriber.RejectDuplicateBindings(merged.Plans, deliveriesOf);
        const described = SnapshotDescriber.Describe(snapshot, {
            DefaultConnector: options.DefaultConnector,
            ConnectorPlans: merged.Plans,
            EmitExternalBindings: true,
        });
        const conflicting = described.Diagnostics.some((d) => d.Code === DescribeDiagnosticCode.ConflictingDefinition);
        const invalid = described.Diagnostics.find((d) => d.Code === DescribeDiagnosticCode.InvalidBinding);
        if (!conflicting && invalid !== undefined)
        {
            const binders = merged.Plans.filter((p) => p.Bindings.some((b) => b.Concept === invalid.Subject)).map((p) => p.Model);
            const deliveries = [...new Set(binders.flatMap((m) => deliveriesOf.get(m) ?? []))].sort();
            throw new EnvironmentCatalogError(EnvironmentCatalogErrorCode.InvalidBinding, invalid.Subject, deliveries,
                MessageFormat.Format(ExternalCatalogDescriber.InvalidBindingMessage, binders.join(ExternalCatalogDescriber.ListSeparator),
                    EnvironmentCatalogError.DeliveredBy(deliveries), invalid.Message));
        }
        const description = described.Description;
        const external = ExternalCatalogDescriber.Described(description, merged.External, options.LocalConnector);
        return {
            Description: description,
            External: new Set(external.map((b) => b.Binding.Concept)),
            Connectors: ExternalCatalogDescriber.Connectors(external, merged.Specs),
            Identity: new ExternalIdentity(description, external),
            Diagnostics: described.Diagnostics,
        };
    }

    /** The external bindings the description kept (the describer drops invalid and duplicate ones), in its order. */
    private static Described(description: ISchemaDescription, candidates: readonly IExternalBinding[], localConnector: string): IExternalBinding[]
    {
        const out: IExternalBinding[] = [];
        for (const bound of description.Bindings)
        {
            if (bound.Connector === BindingTable.EngineStorage || bound.Connector === TodlNames.FileConnector || bound.Connector === localConnector) continue;
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

    /**
     * One package binds each concept once (I2, T12, P12): two different bindings of one concept in one package (two of
     * its models populate it from different connectors or sources, or one of them leaves it to engine storage) are
     * DuplicateBinding, never resolved first-wins. Identical repeats are one binding.
     */
    private static RejectDuplicateBindings(plans: readonly ModelConnectorPlan[], deliveriesOf: ReadonlyMap<string, readonly string[]>): void
    {
        for (const plan of plans)
        {
            const first = new Map<string, ConnectorBinding>();
            for (const binding of plan.Bindings)
            {
                const previous = first.get(binding.Concept);
                if (previous === undefined)
                {
                    first.set(binding.Concept, binding);
                    continue;
                }
                if (ExternalCatalogDescriber.BindingKey(previous) === ExternalCatalogDescriber.BindingKey(binding)) continue;
                const deliveries = [...(deliveriesOf.get(plan.Model) ?? [])].sort();
                throw new EnvironmentCatalogError(EnvironmentCatalogErrorCode.DuplicateBinding, binding.Concept, deliveries,
                    MessageFormat.Format(ExternalCatalogDescriber.DuplicateBindingMessage, plan.Model, EnvironmentCatalogError.DeliveredBy(deliveries), binding.Concept,
                        MessageFormat.Format(ExternalCatalogDescriber.BindingTarget, previous.Connector, previous.Source),
                        MessageFormat.Format(ExternalCatalogDescriber.BindingTarget, binding.Connector, binding.Source)));
            }
        }
    }

    private static BindingKey(binding: ConnectorBinding): string
    {
        const fields = Object.entries(binding.FieldMap).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([member, field]) => member + ExternalCatalogDescriber.KeySeparator + field);
        return JSON.stringify([binding.Connector, binding.Source, binding.IdKey, fields, binding.Writable, binding.VersionField ?? null, binding.Concurrency, binding.Atomicity]);
    }
}
