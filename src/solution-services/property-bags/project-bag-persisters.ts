import { type IPropertyBag, type IStorage } from '@pragmatic-tech-ai/todl-runtime';
import { PROJECT_MANIFEST_FILENAME } from '../project-services/core/project-factory.js';
import { type BagValues } from '../solution-manager/engine/solution-manifest.js';
import { BagScope } from './bag-address.js';
import { type IBagPersister } from './bag-persister.js';
import { RecordPropertyBag } from './record-property-bag.js';

type Live = Map<string, Map<string, Map<string, unknown>>>;

// Shared logic for the two project-scoped, file-backed persisters. Bags live in memory after
// Open (read once, defensive against a missing/corrupt document); writes update memory and mark
// dirty; Flush serializes back through the subclass's writeDocument.
abstract class FileBagPersister implements IBagPersister
{
    public readonly Scope = BagScope.Project;
    private dirty = false;

    protected constructor(protected readonly storage: IStorage, private readonly live: Live)
    {
    }

    public Ids(kind: string): readonly string[]
    {
        return [...(this.live.get(kind)?.keys() ?? [])];
    }

    public Bag(kind: string, id: string): IPropertyBag
    {
        const values = this.live.get(kind)?.get(id) ?? new Map<string, unknown>();
        return new RecordPropertyBag(values, () => { this.dirty = true; });
    }

    public Create(kind: string, id: string): IPropertyBag
    {
        const byId = this.ensure(kind);
        let values = byId.get(id);
        if (values === undefined)
        {
            values = new Map<string, unknown>();
            byId.set(id, values);
            this.dirty = true;
        }
        return new RecordPropertyBag(values, () => { this.dirty = true; });
    }

    public Delete(kind: string, id: string): void
    {
        if (this.live.get(kind)?.delete(id) === true) this.dirty = true;
    }

    public async Flush(): Promise<void>
    {
        if (!this.dirty) return;
        await this.writeDocument(FileBagPersister.serialize(this.live));
        this.dirty = false;
    }

    protected abstract writeDocument(bags: BagValues): Promise<void>;

    private ensure(kind: string): Map<string, Map<string, unknown>>
    {
        let byId = this.live.get(kind);
        if (byId === undefined)
        {
            byId = new Map<string, Map<string, unknown>>();
            this.live.set(kind, byId);
        }
        return byId;
    }

    protected static toLive(bags: BagValues): Live
    {
        const live: Live = new Map();
        for (const [kind, byId] of Object.entries(bags))
        {
            const instances = new Map<string, Map<string, unknown>>();
            for (const [id, values] of Object.entries(byId)) instances.set(id, new Map<string, unknown>(Object.entries(values)));
            live.set(kind, instances);
        }
        return live;
    }

    protected static serialize(live: Live): BagValues
    {
        const out: BagValues = {};
        for (const [kind, byId] of live)
        {
            const outKind: Record<string, Record<string, unknown>> = {};
            for (const [id, values] of byId) outKind[id] = Object.fromEntries(values);
            if (Object.keys(outKind).length > 0) out[kind] = outKind;
        }
        return out;
    }

    protected static async readManifest(storage: IStorage): Promise<Record<string, unknown>>
    {
        try
        {
            const parsed: unknown = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME));
            return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
        }
        catch
        {
            return {};
        }
    }

    protected static async readBagFile(storage: IStorage, fileName: string): Promise<BagValues>
    {
        try
        {
            const parsed: unknown = JSON.parse(await storage.ReadText(fileName));
            return parsed !== null && typeof parsed === 'object' ? (parsed as BagValues) : {};
        }
        catch
        {
            return {};
        }
    }
}

// Project-scoped bags in the SHARED project manifest (project.plexus, committed). Writes merge
// the bags section back, preserving every other manifest field.
export class ProjectSharedBagPersister extends FileBagPersister
{
    private static readonly BagsField = 'bags';

    public static async Open(storage: IStorage): Promise<ProjectSharedBagPersister>
    {
        const manifest = await FileBagPersister.readManifest(storage);
        const raw = manifest[ProjectSharedBagPersister.BagsField];
        const bags = (raw !== null && typeof raw === 'object') ? (raw as BagValues) : {};
        return new ProjectSharedBagPersister(storage, FileBagPersister.toLive(bags));
    }

    private constructor(storage: IStorage, live: Live)
    {
        super(storage, live);
    }

    protected async writeDocument(bags: BagValues): Promise<void>
    {
        const manifest = await FileBagPersister.readManifest(this.storage);
        manifest[ProjectSharedBagPersister.BagsField] = bags;
        await this.storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(manifest, null, 2));
    }
}

// Project-scoped bags in the LOCAL sidecar (project.local.json, gitignored) — user-specific
// data (connections, selections) that must never be committed to the shared manifest.
export class ProjectLocalBagPersister extends FileBagPersister
{
    public static readonly FileName = 'project.local.json';

    public static async Open(storage: IStorage): Promise<ProjectLocalBagPersister>
    {
        const bags = await FileBagPersister.readBagFile(storage, ProjectLocalBagPersister.FileName);
        return new ProjectLocalBagPersister(storage, FileBagPersister.toLive(bags));
    }

    private constructor(storage: IStorage, live: Live)
    {
        super(storage, live);
    }

    protected async writeDocument(bags: BagValues): Promise<void>
    {
        await this.storage.WriteText(ProjectLocalBagPersister.FileName, JSON.stringify(bags, null, 2));
    }
}
