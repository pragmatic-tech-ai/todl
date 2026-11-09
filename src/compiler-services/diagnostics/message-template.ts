/** A message template that names an argument its caller did not give (a template/call mismatch, i.e. a defect). */
export class MessageTemplateError extends Error
{
    private static readonly ErrorName = "MessageTemplateError";

    public constructor(message: string)
    {
        super(message);
        this.name = MessageTemplateError.ErrorName;
    }
}

/**
 * Fills `{n}` placeholders of a message template with its arguments. Engine-free: the `.todl` emitter uses it directly
 * and the engine bridge's MessageFormat wraps it. A placeholder with no argument throws MessageTemplateError instead
 * of silently becoming empty.
 */
export class MessageTemplate
{
    private static readonly Placeholder = /\{(\d+)\}/g;
    private static readonly MissingMessage = "Message template \"{0}\" names argument {1}, which was not given";

    public static Format(template: string, ...args: string[]): string
    {
        return template.replace(MessageTemplate.Placeholder, (_, index: string) =>
        {
            const value = args[Number(index)];
            if (value === undefined)
            {
                throw new MessageTemplateError(MessageTemplate.Format(MessageTemplate.MissingMessage, template, index));
            }
            return value;
        });
    }
}
