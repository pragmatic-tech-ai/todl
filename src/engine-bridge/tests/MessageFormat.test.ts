import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EngineBridgeError, EngineBridgeErrorCode } from '../EngineBridgeError.js';
import { MessageFormat } from '../MessageFormat.js';

class MessageFormatFx
{
    public static readonly Template = '"{0}" of "{1}" ({0})';
    public static readonly First = 'a';
    public static readonly Second = 'b';
    public static readonly Filled = '"a" of "b" (a)';
}

describe('MessageFormat', () =>
{
    test('fills every placeholder, repeated ones included', () =>
    {
        assert.equal(MessageFormat.Format(MessageFormatFx.Template, MessageFormatFx.First, MessageFormatFx.Second), MessageFormatFx.Filled);
    });

    test('a placeholder with no argument throws MessageTemplate naming the template and the slot', () =>
    {
        assert.throws(() => MessageFormat.Format(MessageFormatFx.Template, MessageFormatFx.First), (error: unknown) =>
            error instanceof EngineBridgeError && error.Code === EngineBridgeErrorCode.MessageTemplate
            && error.message.includes(MessageFormatFx.Template) && error.message.includes('1'));
    });
});
