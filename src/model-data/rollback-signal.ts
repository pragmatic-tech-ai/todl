import type { WriteResult } from "./connector-plan.js";

/** Thrown inside a transactional apply to abort the backend transaction, carrying the
 *  {@link WriteResult} (every operation failed/pending) the caller should report. */
export class RollbackSignal extends Error
{
    private static readonly DefaultMessage = "write batch rolled back";

    public readonly Result: WriteResult;

    public constructor(result: WriteResult)
    {
        super(RollbackSignal.DefaultMessage);
        this.name = RollbackSignal.name;
        this.Result = result;
    }
}
