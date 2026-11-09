import { createHash } from 'node:crypto';
import { ModelDraft } from '../../authoring/model-draft.js';
import type { ITodlDraftSession, ITodlModelWorkspace } from '../TodlModelWorkspace.js';

/** One editable model of the memory workspace: its namespace and the uris of its source files. */
class MemoryModel
{
    public readonly Uris = new Set<string>();

    public constructor(public readonly Namespace: string)
    {
    }
}

/** A draft session over the memory workspace; files written for the model join its sources. */
class MemoryDraftSession implements ITodlDraftSession
{
    public constructor(
        private readonly workspace: MemoryModelWorkspace,
        private readonly model: MemoryModel,
        public readonly Draft: ModelDraft,
        public readonly SourceHash: string,
    )
    {
    }

    public get Namespace(): string
    {
        return this.model.Namespace;
    }

    public CurrentSourceHash(): Promise<string>
    {
        return Promise.resolve(this.workspace.HashOf(this.model));
    }

    public ReadFile(uri: string): Promise<string | undefined>
    {
        return Promise.resolve(this.workspace.Files.get(uri));
    }

    public WriteFile(uri: string, text: string): Promise<void>
    {
        return this.workspace.Write(this.model, uri, text);
    }

    public DeleteFile(uri: string): Promise<void>
    {
        this.workspace.Log.push(`${MemoryModelWorkspace.DeleteVerb}${uri}`);
        this.workspace.Files.delete(uri);
        this.model.Uris.delete(uri);
        return Promise.resolve();
    }
}

/**
 * The test seam: models over in-memory files, drafts built with ModelDraft.fromSources. Hooks: OnOpen (after each
 * OpenDraft, with the running count), Gate (the next WriteFile waits on it, once), FailWriteAt (the n-th WriteFile,
 * 1-based, throws), and Log (every write / delete, in order).
 */
export class MemoryModelWorkspace implements ITodlModelWorkspace
{
    public static readonly WriteVerb = 'write ';
    public static readonly DeleteVerb = 'delete ';
    private static readonly HashAlgorithm = 'sha256';
    private static readonly HexEncoding = 'hex';
    private static readonly Separator = '\u0000';
    private static readonly WriteFailure = 'simulated write failure';

    public readonly Files = new Map<string, string>();
    public readonly Log: string[] = [];
    public OnOpen: ((opened: number) => void) | undefined;
    public Gate: Promise<void> | undefined;
    public FailWriteAt: number | undefined;

    private readonly models = new Map<string, MemoryModel>();
    private opened = 0;
    private writes = 0;

    /** Registers `model` with its namespace and source files. */
    public Add(model: string, namespace: string, files: Readonly<Record<string, string>>): void
    {
        const entry = new MemoryModel(namespace);
        for (const [uri, text] of Object.entries(files))
        {
            this.Files.set(uri, text);
            entry.Uris.add(uri);
        }
        this.models.set(model, entry);
    }

    public OpenDraft(model: string): Promise<ITodlDraftSession | undefined>
    {
        const entry = this.models.get(model);
        if (entry === undefined)
        {
            return Promise.resolve(undefined);
        }
        const sources = [...entry.Uris].sort().map((uri) => ({ uri, text: this.Files.get(uri)! }));
        const draft = ModelDraft.fromSources([], sources, { namespace: entry.Namespace });
        const session = new MemoryDraftSession(this, entry, draft, this.HashOf(entry));
        this.opened++;
        this.OnOpen?.(this.opened);
        return Promise.resolve(session);
    }

    /** @internal The hash of a model's current files. */
    public HashOf(model: MemoryModel): string
    {
        const hash = createHash(MemoryModelWorkspace.HashAlgorithm);
        for (const uri of [...model.Uris].sort())
        {
            hash.update(uri + MemoryModelWorkspace.Separator + (this.Files.get(uri) ?? '') + MemoryModelWorkspace.Separator);
        }
        return hash.digest(MemoryModelWorkspace.HexEncoding);
    }

    /** @internal A session's WriteFile: gated, failing, then applied. */
    public async Write(model: MemoryModel, uri: string, text: string): Promise<void>
    {
        const gate = this.Gate;
        this.Gate = undefined;
        if (gate !== undefined)
        {
            await gate;
        }
        this.writes++;
        if (this.FailWriteAt === this.writes)
        {
            throw new Error(MemoryModelWorkspace.WriteFailure);
        }
        this.Log.push(`${MemoryModelWorkspace.WriteVerb}${uri}`);
        this.Files.set(uri, text);
        model.Uris.add(uri);
    }
}
