export enum EngineBridgeErrorCode
{
    UnsupportedFieldType = 1,
    ForeignId,
    UnsupportedValue,
    Stale,
    NotEditable,
    PersistFailed,
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
