import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    AccessDefault,
    AccessScope,
    Cypher,
    FalsePredicate,
    GraphEngine,
    StorageKind,
    type GraphTransaction,
    type IEngineStorage,
    type Predicate,
} from '@pragmatic-tech-ai/graph';
import { compilePackage } from '../../../publish/publish.js';
import { PackageManifestBridge } from '../../../solution-services/package-manager/package-manifest-bridge.js';
import { Domain } from '../../../domain/domain.js';
import { MemoryPackageSource } from '../../../domain/memory-package-source.js';
import { EngineFixture } from '../../tests/EngineFixture.js';
import type { ISnapshotDescription } from '../../SnapshotDescription.js';
import { SystemPackage } from '../../../solution-services/package-manager/system-package.js';
import { ShareRight, ShareSubject, SystemNames } from '../SystemNames.js';
import { ShareGrants } from '../ShareGrants.js';
import { ShareGrantScope, type IShareSubjects } from '../ShareGrantScope.js';

/** One grant to write: the record, the subject and the rights it holds. */
interface IGrant
{
    readonly Record: string;
    readonly Kind: ShareSubject;
    readonly Subject: string;
    readonly Rights: readonly ShareRight[];
    /** The concept the grant is written as; ShareGrant when absent (a lookalike otherwise). */
    readonly Concept?: string;
}

/** A Doc package next to todl.system, opened on one engine backend with records r1 and r2. */
class ShareFx
{
    public static readonly Model = 'docs.p';
    public static readonly Version = '1.0.0';
    public static readonly Doc = 'docs.Doc';
    /** Note copies ShareGrant's members: a lookalike whose `record` edges must never count as grants. */
    public static readonly Lookalike = 'docs.Note';
    public static readonly Source = `namespace docs
{
    concept Doc { }
    concept Note { record : todl.Element; subjectKind : string; subjectId : string; read : boolean?; update : boolean?; delete : boolean?; assign : boolean?; share : boolean?; }
}`;
    public static readonly Anonymous = '';
    public static readonly LookalikeId = 'n1';
    public static readonly R1 = 'r1';
    public static readonly R2 = 'r2';
    public static readonly Principal = 'p';
    public static readonly Team = 't';
    public static readonly OtherPrincipal = 'q';
    public static readonly Match = `MATCH (d:${ShareFx.Doc}) RETURN d`;
    public static readonly TempPrefix = 'todl-share-';
    public static readonly Backends: readonly StorageKind[] = [StorageKind.Memory, StorageKind.Lmdb];

    private static description: ISnapshotDescription | undefined;

    public static async Description(): Promise<ISnapshotDescription>
    {
        if (ShareFx.description === undefined)
        {
            const out = compilePackage([], [{ uri: `${ShareFx.Model}.todl`, text: ShareFx.Source }], { id: ShareFx.Model, version: ShareFx.Version });
            assert.ok(out.ok, JSON.stringify(out.errors));
            const store = new MemoryPackageSource([
                await new SystemPackage().resolve(SystemPackage.Ref),
                PackageManifestBridge.toResolved(out.package!),
            ]);
            const domain = new Domain(store);
            await domain.load(SystemPackage.Ref);
            await domain.load({ model: ShareFx.Model, version: ShareFx.Version });
            ShareFx.description = EngineFixture.Describe(domain.Snapshot);
        }
        return ShareFx.description;
    }

    public static Subjects(teams: readonly string[] = [], principal: string = ShareFx.Principal): IShareSubjects
    {
        return { PrincipalId: principal, Teams: teams };
    }

    public static Scope(subjects: IShareSubjects, grantRows: Predicate = ShareGrantScope.GrantRows(subjects)): AccessScope
    {
        return AccessScope.Build({
            Default: AccessDefault.Allow,
            Rows: new Map<string, Predicate>([
                [ShareFx.Doc, ShareGrantScope.Widening(subjects, ShareRight.Read)],
                [SystemNames.ShareGrant, grantRows],
            ]),
        });
    }

    public static WriteGrant(t: GraphTransaction, grant: IGrant): void
    {
        const id = grant.Concept === undefined ? ShareGrants.PublicId(grant.Record, grant.Kind, grant.Subject) : ShareFx.LookalikeId;
        t.CreateNode(id, grant.Concept ?? SystemNames.ShareGrant);
        for (const [name, value] of ShareGrants.Properties(grant.Kind, grant.Subject, grant.Rights)) t.SetProperty(id, name, value);
        t.Link(id, SystemNames.Record, grant.Record);
    }

    /** Runs `body` on an engine of `kind` holding r1, r2 and `grants`; the engine is disposed (and its directory removed) after. */
    public static async With(kind: StorageKind, grants: readonly IGrant[], body: (engine: GraphEngine) => Promise<void>): Promise<void>
    {
        const dir = kind === StorageKind.Lmdb ? mkdtempSync(join(tmpdir(), ShareFx.TempPrefix)) : undefined;
        const storage: IEngineStorage = dir === undefined ? { Kind: kind } : { Kind: kind, Path: dir };
        const engine = await EngineFixture.Open(await ShareFx.Description(), { Storage: storage });
        try
        {
            const t = await engine.Begin(AccessScope.System);
            t.CreateNode(ShareFx.R1, ShareFx.Doc);
            t.CreateNode(ShareFx.R2, ShareFx.Doc);
            for (const grant of grants) ShareFx.WriteGrant(t, grant);
            await t.Commit();
            await body(engine);
        }
        finally
        {
            await engine.dispose();
            if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
        }
    }

    public static async Docs(engine: GraphEngine, scope: AccessScope): Promise<string[]>
    {
        const result = await new Cypher.CypherEngine(engine).Execute(scope, ShareFx.Match);
        return result.Rows.map((row) => (row[0] as Cypher.NodeValue).Id).sort();
    }

    public static Grant(record: string, rights: readonly ShareRight[], kind = ShareSubject.Principal, subject = ShareFx.Principal): IGrant
    {
        return { Record: record, Kind: kind, Subject: subject, Rights: rights };
    }
}

describe('ShareGrants (ruling T10)', () =>
{
    test('grant id is deterministic and short', () =>
    {
        const a = ShareGrants.PublicId(ShareFx.R1, ShareSubject.Principal, ShareFx.Principal);
        assert.equal(a, ShareGrants.PublicId(ShareFx.R1, ShareSubject.Principal, ShareFx.Principal));
        assert.match(a, /^share\.[0-9a-f]{32}$/);
        assert.notEqual(a, ShareGrants.PublicId(ShareFx.R1, ShareSubject.Principal, ShareFx.OtherPrincipal));
        assert.notEqual(a, ShareGrants.PublicId(ShareFx.R1, ShareSubject.Team, ShareFx.Principal));
    });

    test('an anonymous caller with no teams matches no grant (fail closed)', () =>
    {
        assert.equal(ShareGrantScope.SubjectMatch(ShareFx.Subjects([], ShareFx.Anonymous)), FalsePredicate.Instance);
        assert.equal(ShareGrantScope.SubjectMatch(ShareFx.Subjects([ShareFx.Anonymous], ShareFx.Anonymous)), FalsePredicate.Instance);
    });

    test('properties name the subject and every right, unlisted rights false', () =>
    {
        assert.deepEqual([...ShareGrants.Properties(ShareSubject.Team, ShareFx.Team, [ShareRight.Update])], [
            [SystemNames.SubjectKind, ShareSubject.Team],
            [SystemNames.SubjectId, ShareFx.Team],
            [ShareRight.Read, false],
            [ShareRight.Update, true],
            [ShareRight.Delete, false],
            [ShareRight.Assign, false],
            [ShareRight.Share, false],
        ]);
    });
});

describe('ShareGrantScope widening (ruling T10)', () =>
{
    for (const kind of ShareFx.Backends)
    {
        const backend = StorageKind[kind];

        test(`widening admits a shared record (${backend})`, async () =>
        {
            await ShareFx.With(kind, [ShareFx.Grant(ShareFx.R1, [ShareRight.Read])], async (engine) =>
            {
                assert.deepEqual(await ShareFx.Docs(engine, ShareFx.Scope(ShareFx.Subjects())), [ShareFx.R1]);
            });
        });

        test(`team grant widens (${backend})`, async () =>
        {
            await ShareFx.With(kind, [ShareFx.Grant(ShareFx.R1, [ShareRight.Read], ShareSubject.Team, ShareFx.Team)], async (engine) =>
            {
                assert.deepEqual(await ShareFx.Docs(engine, ShareFx.Scope(ShareFx.Subjects([ShareFx.Team]))), [ShareFx.R1]);
                assert.deepEqual(await ShareFx.Docs(engine, ShareFx.Scope(ShareFx.Subjects())), []);
            });
        });

        test(`grant without the right does not widen (${backend})`, async () =>
        {
            await ShareFx.With(kind, [ShareFx.Grant(ShareFx.R1, [ShareRight.Update])], async (engine) =>
            {
                assert.deepEqual(await ShareFx.Docs(engine, ShareFx.Scope(ShareFx.Subjects())), []);
            });
        });

        test(`grant to another principal does not widen (${backend})`, async () =>
        {
            await ShareFx.With(kind, [ShareFx.Grant(ShareFx.R1, [ShareRight.Read], ShareSubject.Principal, ShareFx.OtherPrincipal)], async (engine) =>
            {
                assert.deepEqual(await ShareFx.Docs(engine, ShareFx.Scope(ShareFx.Subjects())), []);
            });
        });

        test(`a lookalike concept with a record edge does not widen (${backend})`, async () =>
        {
            const forged: IGrant = { ...ShareFx.Grant(ShareFx.R1, [ShareRight.Read]), Concept: ShareFx.Lookalike };
            await ShareFx.With(kind, [forged], async (engine) =>
            {
                assert.deepEqual(await ShareFx.Docs(engine, ShareFx.Scope(ShareFx.Subjects())), []);
            });
        });

        test(`a grant to the empty principal id does not widen for an anonymous caller (${backend})`, async () =>
        {
            const grant = ShareFx.Grant(ShareFx.R1, [ShareRight.Read], ShareSubject.Principal, ShareFx.Anonymous);
            await ShareFx.With(kind, [grant], async (engine) =>
            {
                assert.deepEqual(await ShareFx.Docs(engine, ShareFx.Scope(ShareFx.Subjects([], ShareFx.Anonymous))), []);
            });
        });

        test(`invisible grant does not widen (${backend})`, async () =>
        {
            await ShareFx.With(kind, [ShareFx.Grant(ShareFx.R1, [ShareRight.Read])], async (engine) =>
            {
                assert.deepEqual(await ShareFx.Docs(engine, ShareFx.Scope(ShareFx.Subjects(), FalsePredicate.Instance)), []);
            });
        });

        test(`grant commits with the write (${backend})`, async () =>
        {
            await ShareFx.With(kind, [], async (engine) =>
            {
                const scope = ShareFx.Scope(ShareFx.Subjects());
                const aborted = await engine.Begin(AccessScope.System);
                ShareFx.WriteGrant(aborted, ShareFx.Grant(ShareFx.R2, [ShareRight.Read]));
                aborted.dispose();
                assert.deepEqual(await ShareFx.Docs(engine, scope), []);

                const t = await engine.Begin(AccessScope.System);
                ShareFx.WriteGrant(t, ShareFx.Grant(ShareFx.R2, [ShareRight.Read]));
                await t.Commit();
                assert.deepEqual(await ShareFx.Docs(engine, scope), [ShareFx.R2]);
            });
        });
    }
});
