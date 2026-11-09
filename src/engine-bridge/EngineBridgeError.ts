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

    public constructor(code: EngineBridgeErrorCode, message: string)
    {
        super(message);
        this.name = EngineBridgeError.ErrorName;
        this.Code = code;
    }
}
