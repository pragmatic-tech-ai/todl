import { ValueType, type CellValue } from '@pragmatic-tech-ai/graph';
import type { Scalar } from '../manifest/logical.js';
import { DescribeDiagnosticCode } from './SnapshotDescription.js';

/** The outcome of converting one TODL scalar to an engine cell: a value, or why it was skipped. */
export interface IConversion
{
    readonly Value?: CellValue;
    readonly Failure?: DescribeDiagnosticCode;
}

/** TODL scalar → engine cell conversion per value type. TODL keeps numeric literals as decimal strings. */
export class CellConverter
{
    private static readonly IntegerPattern = /^[+-]?\d+$/;
    private static readonly Int64Bits = 64;

    public static Convert(type: ValueType | undefined, raw: Scalar): IConversion
    {
        switch (type)
        {
            case ValueType.String:
                return typeof raw === 'string' ? { Value: raw } : CellConverter.Fail(DescribeDiagnosticCode.ValueTypeMismatch);
            case ValueType.Boolean:
                return typeof raw === 'boolean' ? { Value: raw } : CellConverter.Fail(DescribeDiagnosticCode.ValueTypeMismatch);
            case ValueType.Float64:
                return CellConverter.ToFloat(raw);
            case ValueType.Int64:
                return CellConverter.ToInteger(raw);
            default:
                return CellConverter.Fail(DescribeDiagnosticCode.ValueTypeMismatch);
        }
    }

    private static ToFloat(raw: Scalar): IConversion
    {
        const value = CellConverter.Numeric(raw);
        return value === undefined ? CellConverter.Fail(DescribeDiagnosticCode.ValueTypeMismatch) : { Value: value };
    }

    private static ToInteger(raw: Scalar): IConversion
    {
        // A decimal digit string converts exactly, whatever its size (then range-checked).
        if (typeof raw === 'string' && CellConverter.IntegerPattern.test(raw.trim()))
        {
            return CellConverter.InRange(BigInt(raw.trim()));
        }
        // Anything else went through a double (a JS number, or a string like "1e17"): above 2^53 it may already have
        // lost digits, so a non-safe integer is rejected rather than converted to an imprecise BigInt.
        const value = CellConverter.Numeric(raw);
        if (value === undefined)
        {
            return CellConverter.Fail(DescribeDiagnosticCode.ValueTypeMismatch);
        }
        if (!Number.isInteger(value))
        {
            return CellConverter.Fail(DescribeDiagnosticCode.NonIntegralInteger);
        }
        return Number.isSafeInteger(value) ? { Value: BigInt(value) } : CellConverter.Fail(DescribeDiagnosticCode.IntegerOutOfRange);
    }

    /** An Int64 cell, or IntegerOutOfRange when the value does not fit a signed 64-bit integer. */
    private static InRange(value: bigint): IConversion
    {
        return BigInt.asIntN(CellConverter.Int64Bits, value) === value
            ? { Value: value }
            : CellConverter.Fail(DescribeDiagnosticCode.IntegerOutOfRange);
    }

    /** A finite number from a JS number or a numeric string; undefined otherwise. */
    private static Numeric(raw: Scalar): number | undefined
    {
        if (typeof raw === 'number')
        {
            return Number.isFinite(raw) ? raw : undefined;
        }
        if (typeof raw !== 'string' || raw.trim().length === 0)
        {
            return undefined;
        }
        const value = Number(raw);
        return Number.isFinite(value) ? value : undefined;
    }

    private static Fail(code: DescribeDiagnosticCode): IConversion
    {
        return { Failure: code };
    }
}
