import { MessageTemplate, MessageTemplateError } from '../compiler-services/diagnostics/message-template.js';
import { EngineBridgeError, EngineBridgeErrorCode } from './EngineBridgeError.js';

/** The bridge's message formatter: MessageTemplate, with a missing argument raised as an EngineBridgeError. */
export class MessageFormat
{
    /** Throws (MessageTemplate) when the template names an argument that was not given: a template/call mismatch. */
    public static Format(template: string, ...args: string[]): string
    {
        try
        {
            return MessageTemplate.Format(template, ...args);
        }
        catch (error)
        {
            if (error instanceof MessageTemplateError)
            {
                throw new EngineBridgeError(EngineBridgeErrorCode.MessageTemplate, error.message, error);
            }
            throw error;
        }
    }
}
