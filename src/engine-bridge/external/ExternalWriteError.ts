import type { WriteFailure } from '../../model-data/connector-plan.js';
import { EngineBridgeError, type EngineBridgeErrorCode } from '../EngineBridgeError.js';
import type { IExternalBinding } from './ExternalBinding.js';

/**
 * An external write that did not persist (ruling T9): code ExternalWriteFailed when a batch reported per-operation
 * failures at Commit, CompensationFailed when undoing an applied write at Revert failed. It names the binding and
 * carries the source's failures with their kinds (conflict, unsupported, error); a compensation whose adapter call threw
 * carries no failures and keeps the thrown error as `cause`.
 */
export class ExternalWriteError extends EngineBridgeError
{
    private static readonly WriteErrorName = 'ExternalWriteError';

    public constructor(
        code: EngineBridgeErrorCode.ExternalWriteFailed | EngineBridgeErrorCode.CompensationFailed,
        message: string,
        public readonly Binding: IExternalBinding,
        public readonly Failures: readonly WriteFailure[],
        cause?: unknown,
    )
    {
        super(code, message, cause);
        this.name = ExternalWriteError.WriteErrorName;
    }
}
