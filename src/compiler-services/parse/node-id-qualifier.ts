export class NodeIdQualifier
{
    private static readonly Builtins: ReadonlySet<string> = new Set(['string', 'number', 'integer', 'boolean']);
    private static readonly Separator = '.';

    public static IsBuiltin(name: string): boolean
    {
        return NodeIdQualifier.Builtins.has(name);
    }

    /** The last dot-segment of a (possibly namespace-qualified) id. */
    public static LocalId(id: string): string
    {
        return id.slice(id.lastIndexOf(NodeIdQualifier.Separator) + 1);
    }

    public static Qualify(namespace: string | null, localName: string): string
    {
        if (namespace === null || NodeIdQualifier.IsBuiltin(localName))
        {
            return localName;
        }
        return `${namespace}${NodeIdQualifier.Separator}${localName}`;
    }
}
