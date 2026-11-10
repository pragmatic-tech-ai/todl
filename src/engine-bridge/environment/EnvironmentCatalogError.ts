/** Why an environment catalog could not be composed. Append-only: never renumber or reuse a value. */
export enum EnvironmentCatalogErrorCode
{
    /** Two deliveries (or their dependencies) ask for versions of one model that cannot be unified (ruling T11). */
    IncompatibleVersions = 1,
    /** Two connector specs with one engine name that are not the same spec (ruling T2). */
    ConflictingConnector,
    /** A connector spec whose engine name is reserved: `engine` or `todl-file` (ruling T2). */
    ReservedConnectorName,
    /** Two models declare one concept or aspect full name with different shapes (ruling T12). */
    ConflictingDefinition,
    /** Two models bind one (concept, connector, source), so their external public ids would collide (ruling T4). */
    DuplicateExternalSource,
    /** A binding whose connector the environment cannot resolve: no spec of that name is visible to the package that
     *  binds it (controller ruling P12; a binding never falls back to engine storage silently). */
    UnknownConnector,
}

/**
 * A delivery set that cannot form one environment. `Subject` is what the conflict is about (a model id, a connector
 * name, a concept full name or an external source), and `Deliveries` names the deliveries (app names or promote set ids)
 * that brought the conflicting packages in, sorted.
 */
export class EnvironmentCatalogError extends Error
{
    private static readonly ErrorName = 'EnvironmentCatalogError';
    private static readonly ListSeparator = ', ';
    private static readonly DeliveredByOpen = ' (delivered by ';
    private static readonly DeliveredByClose = ')';
    private static readonly NoDeliveries = '';

    public readonly Code: EnvironmentCatalogErrorCode;
    public readonly Subject: string;
    public readonly Deliveries: readonly string[];

    public constructor(code: EnvironmentCatalogErrorCode, subject: string, deliveries: readonly string[], message: string)
    {
        super(message);
        this.name = EnvironmentCatalogError.ErrorName;
        this.Code = code;
        this.Subject = subject;
        this.Deliveries = Object.freeze([...deliveries]);
    }

    /**
     * The deliveries clause of an error message: ` (delivered by "a", "b")`, each name quoted, or nothing when no
     * delivery is known.
     */
    public static DeliveredBy(deliveries: readonly string[]): string
    {
        if (deliveries.length === 0) return EnvironmentCatalogError.NoDeliveries;
        return EnvironmentCatalogError.DeliveredByOpen + deliveries.map((d) => JSON.stringify(d)).join(EnvironmentCatalogError.ListSeparator)
            + EnvironmentCatalogError.DeliveredByClose;
    }
}
