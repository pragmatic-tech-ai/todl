import { EngineBridgeError, EngineBridgeErrorCode } from './EngineBridgeError.js';

/** Fills `{n}` placeholders of a message template with its arguments; the one message formatter of the bridge. */
export class MessageFormat
{
    private static readonly Placeholder = /\{(\d+)\}/g;
    private static readonly MissingMessage = 'Message template "{0}" names argument {1}, which was not given';

    /** Throws (MessageTemplate) when the template names an argument that was not given: a template/call mismatch. */
    public static Format(template: string, ...args: string[]): string
    {
        return template.replace(MessageFormat.Placeholder, (_, index: string) =>
        {
            const value = args[Number(index)];
            if (value === undefined)
            {
                throw new EngineBridgeError(EngineBridgeErrorCode.MessageTemplate, MessageFormat.Format(MessageFormat.MissingMessage, template, index));
            }
            return value;
        });
    }
}
