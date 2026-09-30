import { type IStorage } from '@pragmatic-tech-ai/todl-runtime';
import { BagAddress, BagScope } from './bag-address.js';
import { type IBagPersister } from './bag-persister.js';
import { ConnectionBag, ConnectionBagKind, TokenSource } from './connection-bag.js';
import { ConnectionSelectionKind, ConnectionPurpose } from './connection-resolution.js';

// The persisted shape of the legacy global connections file (userData/connections.json). Secrets
// were never inline here: a Stored token lives in the secret store keyed by the connection id, an
// Env token is read from TokenEnvVar.
interface LegacyConnectionsFile
{
    defaultId?: string;
    default?: string;
    connections?: readonly LegacyConnectionRecord[];
}

interface LegacyConnectionRecord
{
    Id?: string;
    DisplayName?: string;
    RegistryType?: string;
    Settings?: Record<string, unknown>;
    TokenSource?: string;
    TokenEnvVar?: string;
}

// One-shot readers that lift the pre-bags persistence formats into the scope-based property-bag
// world. Each writes a bagsVersion marker into the scope it migrated and no-ops when the marker is
// already present, so a hand-added bag written after the first run is never duplicated or dropped.
export class BagMigration
{
    public static readonly MarkerKind = 'bag-migration';
    public static readonly MarkerId = 'marker';
    public static readonly SelectionId = 'main';

    private static readonly VersionKey = 'bagsVersion';
    private static readonly CurrentVersion = 1;
    private static readonly ConnectionsFileName = 'connections.json';
    private static readonly DefaultOverrideKey = '__default__';

    // Read userData/connections.json and write one global npm-connection bag per connection (fields
    // only — the token stays in the secret store; a Stored connection's TokenRef is its id). Marks
    // the default connection IsDefault. No file ⇒ nothing (not even a marker), so a file created
    // later still migrates.
    public async MigrateGlobal(storage: IStorage, global: IBagPersister): Promise<void>
    {
        if (BagMigration.hasMarker(global)) return;
        if (!(await storage.Exists(BagMigration.ConnectionsFileName))) return;

        const file = await BagMigration.readConnections(storage);
        const defaultId = file.defaultId ?? file.default ?? '';
        for (const record of file.connections ?? [])
        {
            if (typeof record.Id !== 'string' || record.Id.length === 0) continue;
            BagMigration.writeConnection(global, record, record.Id === defaultId);
        }
        BagMigration.stampMarker(global);
        await global.Flush();
    }

    // Lift the legacy solution-level connection overrides (memberPath → connection id) into each
    // member's project-local connection-selection[reference-resolution], pointing at the global
    // connection the id migrated to. Marks the solution scope; a second run no-ops.
    public async MigrateSolution(
        overrides: ReadonlyMap<string, string>,
        solution: IBagPersister,
        projectLocalFor: (memberPath: string) => IBagPersister | undefined,
    ): Promise<void>
    {
        if (BagMigration.hasMarker(solution)) return;

        for (const [memberPath, connectionId] of overrides)
        {
            if (memberPath === BagMigration.DefaultOverrideKey || connectionId.length === 0) continue;
            const local = projectLocalFor(memberPath);
            if (local === undefined) continue;
            const address = new BagAddress(BagScope.Global, ConnectionBagKind, connectionId);
            local.Create(ConnectionSelectionKind, BagMigration.SelectionId).SetValue(ConnectionPurpose.ReferenceResolution, BagAddress.Key(address));
            await local.Flush();
        }
        BagMigration.stampMarker(solution);
        await solution.Flush();
    }

    private static async readConnections(storage: IStorage): Promise<LegacyConnectionsFile>
    {
        try
        {
            const parsed: unknown = JSON.parse(await storage.ReadText(BagMigration.ConnectionsFileName));
            return (parsed !== null && typeof parsed === 'object') ? (parsed as LegacyConnectionsFile) : {};
        }
        catch
        {
            return {};
        }
    }

    private static writeConnection(global: IBagPersister, record: LegacyConnectionRecord, isDefault: boolean): void
    {
        const conn = new ConnectionBag(global.Create(ConnectionBagKind, record.Id!));
        conn.DisplayName = record.DisplayName ?? '';
        conn.RegistryType = record.RegistryType ?? '';
        conn.Settings = record.Settings ?? {};
        conn.IsDefault = isDefault;
        if (record.TokenSource === TokenSource.Env)
        {
            conn.TokenSource = TokenSource.Env;
            conn.TokenEnvVar = record.TokenEnvVar ?? '';
        }
        else
        {
            conn.TokenSource = TokenSource.Stored;
            conn.TokenRef = record.Id!;   // Stored secret is keyed by the connection id
        }
    }

    private static hasMarker(persister: IBagPersister): boolean
    {
        if (!persister.Ids(BagMigration.MarkerKind).includes(BagMigration.MarkerId)) return false;
        return persister.Bag(BagMigration.MarkerKind, BagMigration.MarkerId).GetValue(BagMigration.VersionKey) === BagMigration.CurrentVersion;
    }

    private static stampMarker(persister: IBagPersister): void
    {
        persister.Create(BagMigration.MarkerKind, BagMigration.MarkerId).SetValue(BagMigration.VersionKey, BagMigration.CurrentVersion);
    }
}
