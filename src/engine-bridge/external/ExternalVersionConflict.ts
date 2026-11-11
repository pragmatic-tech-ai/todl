import { ConflictError } from '@pragmatic-tech-ai/graph';
import type { WriteFailure } from '../../model-data/connector-plan.js';
import type { IExternalBinding } from './ExternalBinding.js';

/**
 * An Optimistic external write whose expected version is stale (rulings R119 V2, R120 V4, R122 G1): the row changed (or
 * went away) since this transaction read it. It is the engine's ConflictError, so `ConnectorError.IsConflict` reports it
 * and a retry on a fresh read may succeed. It names the binding and carries the conflicting keys as Conflict failures.
 */
export class ExternalVersionConflict extends ConflictError
{
    private static readonly ConflictName = 'ExternalVersionConflict';

    public constructor(message: string, public readonly Binding: IExternalBinding, public readonly Failures: readonly WriteFailure[])
    {
        super(message);
        this.name = ExternalVersionConflict.ConflictName;
    }
}
