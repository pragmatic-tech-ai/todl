import { DateTimeValue, DateValue, DurationValue, type CellValue, type RowVersion, type ValueType } from '@pragmatic-tech-ai/graph';
import type { ExternalFieldValue } from '../../model-data/connector-plan.js';
import { CellConverter } from '../CellConversion.js';
import { EngineBridgeError, EngineBridgeErrorCode } from '../EngineBridgeError.js';
import { DescribeDiagnosticCode } from '../SnapshotDescription.js';

/** Conversion between external field values and engine cells (rulings T5, T7). */
export class ExternalValues
{
    private static readonly ErrRowInvalid = 'External value does not fit the member type: ';
    private static readonly ErrTemporal = 'A temporal value cannot be written to an external source: ';
    private static readonly ReasonStart = ' (';
    private static readonly ReasonEnd = ')';
    private static readonly ErrVersion = 'External row version is not a string or a finite number: ';

    /** The engine cell for an external value; null stays null. Throws ExternalRowInvalid naming `subject`. */
    public static ToCell(type: ValueType, value: ExternalFieldValue, subject: string): CellValue
    {
        if (value === null)
        {
            return null;
        }
        const converted = CellConverter.Convert(type, value);
        if (converted.Failure !== undefined)
        {
            throw new EngineBridgeError(
                EngineBridgeErrorCode.ExternalRowInvalid,
                ExternalValues.ErrRowInvalid + subject + ExternalValues.ReasonStart + DescribeDiagnosticCode[converted.Failure] + ExternalValues.ReasonEnd);
        }
        return converted.Value ?? null;
    }

    /** The external value for an engine cell: a safe bigint is a number, any other bigint decimal text. */
    public static ToExternal(value: CellValue, subject: string): ExternalFieldValue
    {
        if (typeof value === 'bigint')
        {
            const asNumber = Number(value);
            return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
        }
        if (value instanceof DateValue || value instanceof DateTimeValue || value instanceof DurationValue)
        {
            throw new EngineBridgeError(EngineBridgeErrorCode.UnsupportedExternalChange, ExternalValues.ErrTemporal + subject);
        }
        return value as ExternalFieldValue;
    }

    /**
     * The row version of a source's version-field value (ruling R119 V1): a string or a finite number passes, null is
     * absent, anything else (a boolean, a non-finite number) is ExternalRowInvalid naming `subject`.
     */
    public static ToVersion(value: ExternalFieldValue, subject: string): RowVersion | undefined
    {
        if (value === null)
        {
            return undefined;
        }
        if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)))
        {
            return value;
        }
        throw new EngineBridgeError(EngineBridgeErrorCode.ExternalRowInvalid, ExternalValues.ErrVersion + subject);
    }

    /** The source value of a row version: a string or number as is, a bigint as ToExternal sends it. */
    public static FromVersion(version: RowVersion): ExternalFieldValue
    {
        if (typeof version === 'bigint')
        {
            const asNumber = Number(version);
            return Number.isSafeInteger(asNumber) ? asNumber : version.toString();
        }
        return version;
    }
}
