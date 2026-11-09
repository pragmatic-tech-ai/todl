/** Why the bridge refused or failed. Append-only: never renumber or reuse a value. */
export enum EngineBridgeErrorCode
{
    UnsupportedFieldType = 1,
    ForeignId,
    UnsupportedValue,
    Stale,
    NotEditable,
    PersistFailed,
    /** A message template names an argument its caller did not give (a bridge defect). */
    MessageTemplate,
    /** A connector transaction was used after it stopped taking changes (committing, committed or reverted). */
    TransactionClosed,
    /**
     * Retired (ruling F-d): a saved model whose id equals the solution name is now the compile diagnostic
     * `DiagnosticCode.SavedModelSolutionCollision`, not an error. Kept so later values are never renumbered.
     */
    SolutionModelCollision,
}

/** Failure raised by the TODL-on-engine bridge; Code identifies the category. */
export class EngineBridgeError extends Error
{
    private static readonly ErrorName = 'EngineBridgeError';

    public readonly Code: EngineBridgeErrorCode;

    /** `cause`, when given, is the underlying failure (a storage or emitter error), kept for diagnostics. */
    public constructor(code: EngineBridgeErrorCode, message: string, cause?: unknown)
    {
        super(message, cause === undefined ? undefined : { cause });
        this.name = EngineBridgeError.ErrorName;
        this.Code = code;
    }
}
