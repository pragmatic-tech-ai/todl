/**
 * The decimal text of a finite JS number as TODL keeps numeric values (the parser holds numeric literals as decimal
 * strings): `String(n)`, except that -0 keeps its sign (`String(-0)` is "0"), so a Float64 -0 reads back as -0. The one
 * home of that rule for the `.todl` emitter and the engine bridge's value converter.
 */
export class NumericText
{
    public static readonly NegativeZero = "-0";

    public static Of(value: number): string
    {
        return Object.is(value, -0) ? NumericText.NegativeZero : String(value);
    }
}
