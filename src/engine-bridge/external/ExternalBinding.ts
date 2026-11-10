import type { ConnectorBinding, ConnectorSpec } from '../../model-data/connector-plan.js';

/** One TODL connector binding, resolved to the engine connector name that serves it (ruling T2). */
export interface IExternalBinding
{
    readonly Model: string;
    /** The T2 engine name: `ConnectorSpec.Id ?? ConnectorSpec.Name`. */
    readonly Connector: string;
    readonly Binding: ConnectorBinding;
}

/** One external connector with every binding that points at it. */
export interface IExternalConnectorPlan
{
    readonly Name: string;
    readonly Spec: ConnectorSpec;
    readonly Bindings: readonly IExternalBinding[];
}

/** A public id split into the binding that minted it and the storage id inside the source. */
export interface IParsedExternalId
{
    readonly Binding: IExternalBinding;
    readonly StorageId: string;
}
