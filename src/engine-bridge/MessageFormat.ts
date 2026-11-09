/** Fills `{n}` placeholders of a message template with its arguments (a missing argument becomes empty). */
export class MessageFormat
{
    private static readonly Placeholder = /\{(\d+)\}/g;
    private static readonly Missing = '';

    public static Format(template: string, ...args: string[]): string
    {
        return template.replace(MessageFormat.Placeholder, (_, index: string) => args[Number(index)] ?? MessageFormat.Missing);
    }
}
