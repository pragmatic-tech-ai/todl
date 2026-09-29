import { ProjectNodeKind } from '../core/project.js'

// Provider-scoped presentation families for content nodes (below the provider
// boundary — never contributor-matched). Recorded in Mural's KEY-NAMESPACES.md.
export class ContentNodeKey
{
    public static readonly Folder = 'folder'
    public static readonly File = 'file'
    public static readonly Diagram = 'diagram'
    public static readonly Todl = 'todl'

    public static For(kind: ProjectNodeKind): string
    {
        switch (kind)
        {
            case ProjectNodeKind.Folder:  return ContentNodeKey.Folder
            case ProjectNodeKind.Diagram: return ContentNodeKey.Diagram
            case ProjectNodeKind.Todl:    return ContentNodeKey.Todl
            default:                      return ContentNodeKey.File
        }
    }
}
