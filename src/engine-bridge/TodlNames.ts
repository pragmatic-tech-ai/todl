/** Names the TODL-on-engine bridge reserves in the engine's schema and connector space. */
export class TodlNames
{
    /** The root definition every TODL concept descends from. */
    public static readonly Element = 'todl.Element';
    /** The definition every taxonomy term is seeded as. */
    public static readonly Term = 'todl.Term';
    /** Reserved root property: the instance's explicit label, null when it has none (no display fallback). */
    public static readonly Label = 'label';
    /** Reserved root property: the instance's class (term) id, null when it has none. */
    public static readonly Class = 'class';
    /** `todl.Term` property: the full name of the taxonomy the term belongs to. */
    public static readonly Taxonomy = 'taxonomy';
    /** `todl.Term` relationship: the term's broader term. */
    public static readonly Broader = 'broader';
    /** The name of the connector that stores nodes in `.todl` source files; the file connector takes this name. */
    public static readonly FileConnector = 'todl-file';
}
