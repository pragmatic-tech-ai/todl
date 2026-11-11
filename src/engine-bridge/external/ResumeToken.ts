import type { ExternalFieldValue } from '../../model-data/connector-plan.js';
import { EngineBridgeError, EngineBridgeErrorCode } from '../EngineBridgeError.js';

/**
 * The resume token of a keyset-paged fetch (ruling T8): `'1.' + base64url(JSON.stringify({ After }))`, where After is
 * the page's `NextAfter`. The engine hands it back verbatim; anything else is malformed and throws ExternalRowInvalid.
 */
export class ResumeToken
{
    public static readonly Prefix = '1.';
    private static readonly Encoding = 'base64url';
    private static readonly AfterKey = 'After';
    private static readonly ErrMalformed = 'Malformed external resume token: ';

    public static Encode(after: ExternalFieldValue): string
    {
        return ResumeToken.Prefix + Buffer.from(JSON.stringify({ [ResumeToken.AfterKey]: after })).toString(ResumeToken.Encoding);
    }

    public static Decode(token: string): ExternalFieldValue
    {
        if (!token.startsWith(ResumeToken.Prefix))
        {
            throw ResumeToken.Malformed(token);
        }
        const body = token.slice(ResumeToken.Prefix.length);
        const bytes = Buffer.from(body, ResumeToken.Encoding);
        // Buffer decoding skips characters outside the alphabet: a body that does not re-encode to itself is not ours.
        if (bytes.toString(ResumeToken.Encoding) !== body)
        {
            throw ResumeToken.Malformed(token);
        }
        let parsed: unknown;
        try
        {
            parsed = JSON.parse(bytes.toString());
        }
        catch (error)
        {
            throw new EngineBridgeError(EngineBridgeErrorCode.ExternalRowInvalid, ResumeToken.ErrMalformed + token, error);
        }
        if (typeof parsed !== 'object' || parsed === null || !Object.hasOwn(parsed, ResumeToken.AfterKey))
        {
            throw ResumeToken.Malformed(token);
        }
        const after = (parsed as Record<string, unknown>)[ResumeToken.AfterKey];
        if (after !== null && typeof after !== 'string' && typeof after !== 'number' && typeof after !== 'boolean')
        {
            throw ResumeToken.Malformed(token);
        }
        return after;
    }

    private static Malformed(token: string): EngineBridgeError
    {
        return new EngineBridgeError(EngineBridgeErrorCode.ExternalRowInvalid, ResumeToken.ErrMalformed + token);
    }
}
