import { type IStorage } from '@pragmatic-tech-ai/todl-runtime';
import { type SolutionMember } from '../../solution-manager/engine/solution-member.js';
import { type IContentLifecycleGuard } from './content-lifecycle.js';
import { UniqueName } from './unique-name.js';

export enum RenameError
{
    Empty,
    Collision,
    Invalid,
}

export type RenameResult = { ok: true; to: string } | { ok: false; error: RenameError };

export type MoveResult = { moved: readonly { from: string; to: string }[]; skipped: readonly string[] };

export interface ImportFile
{
    name: string;
    bytes: Uint8Array;
}

// Headless content mutations (rename/delete/new/import/move) for one solution member's
// project storage. Path-keyed over the member's IStorage -- the same storage the
// ProjectContentStore watches, so its tree updates from the watcher delta. UX-free:
// prompts and open-editor management are delegated to the optional lifecycle guard.
export class MemberContentOps
{
    private static readonly DefaultFolderName = 'New Folder';
    private static readonly Separator = '/';
    private static readonly InvalidNamePattern = /[\\/]/;
    private static readonly NoStorageMessage = 'Member has no storage';

    constructor(private readonly member: SolutionMember, private readonly guard?: IContentLifecycleGuard)
    {
    }

    public async Rename(path: string, newName: string): Promise<RenameResult>
    {
        const proposed = newName.trim();
        if (proposed === '') return { ok: false, error: RenameError.Empty };
        if (MemberContentOps.InvalidNamePattern.test(proposed)) return { ok: false, error: RenameError.Invalid };
        if (proposed === MemberContentOps.BaseName(path)) return { ok: true, to: path };
        const storage = this.Storage();
        const to = MemberContentOps.Join(MemberContentOps.ParentOf(path), proposed);
        if (await storage.Exists(to)) return { ok: false, error: RenameError.Collision };
        await storage.Rename(path, to);
        this.guard?.OnMoved(this.member, path, to);
        return { ok: true, to };
    }

    public async Delete(paths: readonly string[]): Promise<void>
    {
        const roots = MemberContentOps.Roots(paths.filter((p) => p !== ''));
        if (roots.length === 0) return;
        if (this.guard !== undefined && !(await this.guard.CanRemove(this.member, roots))) return;
        const storage = this.Storage();
        for (const path of roots) await storage.Delete(path);
        this.guard?.OnRemoved(this.member, roots);
    }

    public async NewFile(folder: string, name: string, content: string): Promise<string>
    {
        const storage = this.Storage();
        const path = await UniqueName.For(storage, MemberContentOps.Join(folder, name));
        await storage.WriteText(path, content);
        return path;
    }

    public async NewFolder(folder: string, name: string = MemberContentOps.DefaultFolderName): Promise<string>
    {
        const storage = this.Storage();
        const path = await UniqueName.For(storage, MemberContentOps.Join(folder, name));
        await storage.CreateDirectory(path);
        return path;
    }

    public async ImportBytes(target: string, files: readonly ImportFile[]): Promise<string[]>
    {
        const storage = this.Storage();
        const added: string[] = [];
        for (const file of files)
        {
            const path = await UniqueName.For(storage, MemberContentOps.Join(target, file.name));
            await storage.WriteBytes(path, file.bytes);
            added.push(path);
        }
        return added;
    }

    public async Move(paths: readonly string[], destFolder: string): Promise<MoveResult>
    {
        const storage = this.Storage();
        const plan = MemberContentOps.PlanMoves(paths, destFolder);
        const moved: { from: string; to: string }[] = [];
        const skipped: string[] = [...plan.rejected];
        for (const m of plan.moves)
        {
            if (await storage.Exists(m.to))
            {
                skipped.push(m.from);
                continue;
            }
            await storage.Rename(m.from, m.to);
            this.guard?.OnMoved(this.member, m.from, m.to);
            moved.push(m);
        }
        return { moved, skipped };
    }

    // Pure move planning: drops a path whose ancestor is also selected (a folder move
    // carries its descendants) and a path already in the destination; a folder moved
    // into itself or a descendant is rejected.
    public static PlanMoves(paths: readonly string[], destFolder: string):
        { moves: { from: string; to: string }[]; rejected: string[] }
    {
        const moves: { from: string; to: string }[] = [];
        const rejected: string[] = [];
        for (const path of paths)
        {
            if (path === '') continue;
            if (paths.some((p) => p !== path && path.startsWith(p + MemberContentOps.Separator))) continue;
            if (MemberContentOps.ParentOf(path) === destFolder) continue;
            if (destFolder === path || destFolder.startsWith(path + MemberContentOps.Separator))
            {
                rejected.push(path);
                continue;
            }
            moves.push({ from: path, to: MemberContentOps.Join(destFolder, MemberContentOps.BaseName(path)) });
        }
        return { moves, rejected };
    }

    private Storage(): IStorage
    {
        const storage = this.member.Storage;
        if (storage === undefined) throw new Error(MemberContentOps.NoStorageMessage);
        return storage;
    }

    private static Roots(paths: readonly string[]): string[]
    {
        return paths.filter((path) => !paths.some((p) => p !== path && path.startsWith(p + MemberContentOps.Separator)));
    }

    private static Join(dir: string, name: string): string
    {
        return dir === '' ? name : dir + MemberContentOps.Separator + name;
    }

    private static ParentOf(path: string): string
    {
        const i = path.lastIndexOf(MemberContentOps.Separator);
        return i === -1 ? '' : path.slice(0, i);
    }

    private static BaseName(path: string): string
    {
        const i = path.lastIndexOf(MemberContentOps.Separator);
        return i === -1 ? path : path.slice(i + 1);
    }
}
