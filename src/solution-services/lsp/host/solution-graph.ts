import { Signal, type IStorage } from '@pragmatic-tech-ai/todl-runtime';
import { mergeBases } from '../../../compiler-services/api.js';
import { loadInto } from '../../../compiler-services/parse/loader.js';
import { preludeDocument, preludeNames } from '../../../compiler-services/stdlib/prelude.js';
import { validate } from '../../../compiler-services/validate/validate.js';
import { Repository } from '../../../compiler-services/model/model.js';
import { SnowflakeIdGenerator, type IdGenerator } from '../../../compiler-services/model/id-generator.js';
import type { Diagnostic } from '../../../compiler-services/diagnostics/diagnostic.js';
import type { SourceFile } from '../../../compiler-services/diagnostics/span.js';
import type { TodlDocument } from '../../../compiler-services/emit/json.js';
import { WikiLocator, type WikiOrigin } from '../../project-services/core/wiki-origin.js';

export interface SolutionGraphMember
{
    id: string;
    storage: IStorage;
    sources: readonly SourceFile[];
    baseIds: readonly string[];
    publishedBases: readonly TodlDocument[];
}

export interface SolutionGraphChange
{
    memberIds: readonly string[];
}

/**
 * One Repository for the whole open solution: prelude + published bases merged once,
 * every source member loaded in, bases shared (no per-member copy).
 */
export class SolutionGraph
{
    private static readonly ModelScopeUri = '<model>';
    private static readonly DuplicateIdMessage = 'Duplicate solution member id';
    private static readonly CycleMessage = 'Solution member dependency cycle';
    private static readonly CycleSeparator = ' -> ';
    private static readonly UnknownMemberMessage = 'Unknown solution member id';

    private readonly idGen: IdGenerator = new SnowflakeIdGenerator();
    private model: Repository = new Repository(mergeBases([preludeDocument()]));
    private provenance: Map<string, string> = new Map();
    private memberOf: Map<string, string> = new Map();
    private originOf: Map<string, WikiOrigin> = new Map();
    private sourcesOf: Map<string, SourceFile[]> = new Map();
    private diagnosticsByUri: Map<string, Diagnostic[]> = new Map();
    private membersById: Map<string, SolutionGraphMember> = new Map();
    private loadDiagsByMember: Map<string, Diagnostic[]> = new Map();

    public readonly Changed: Signal<SolutionGraphChange> = new Signal<SolutionGraphChange>();

    public get Model(): Repository
    {
        return this.model;
    }

    public get OriginOf(): ReadonlyMap<string, WikiOrigin>
    {
        return this.originOf;
    }

    /** True once `memberId` has been built into the graph (so ReplaceMember is safe). */
    public Has(memberId: string): boolean
    {
        return this.membersById.has(memberId);
    }

    public DiagnosticsByUri(): ReadonlyMap<string, Diagnostic[]>
    {
        return this.diagnosticsByUri;
    }

    public async Build(members: readonly SolutionGraphMember[]): Promise<void>
    {
        this.provenance = new Map();
        this.memberOf = new Map();
        this.originOf = new Map();
        this.sourcesOf = new Map();
        this.diagnosticsByUri = new Map();
        this.membersById = new Map();
        this.loadDiagsByMember = new Map();

        const bases = this.DistinctBases(members);
        this.model = new Repository(mergeBases([preludeDocument(), ...bases]));

        for (const member of this.TopoOrder(members))
        {
            this.membersById.set(member.id, member);
            this.sourcesOf.set(member.id, [...member.sources]);
            this.LoadMember(member, member.sources);
        }
        this.RebuildDiagnostics();
    }

    /** Members whose baseIds include `memberId`, transitively. */
    public DependentsOf(memberId: string): readonly string[]
    {
        const found = new Set<string>();
        const queue: string[] = [memberId];
        while (queue.length > 0)
        {
            const current = queue.shift() as string;
            for (const m of this.membersById.values())
            {
                if (m.baseIds.includes(current) && !found.has(m.id))
                {
                    found.add(m.id);
                    queue.push(m.id);
                }
            }
        }
        return [...found];
    }

    public ReplaceMember(memberId: string, sources: readonly SourceFile[]): void
    {
        if (!this.membersById.has(memberId))
        {
            throw new Error(`${SolutionGraph.UnknownMemberMessage}: ${memberId}`);
        }
        const affectedSet = new Set<string>([memberId, ...this.DependentsOf(memberId)]);
        const affected = this.TopoOrder([...this.membersById.values()])
            .filter(m => affectedSet.has(m.id));

        for (const member of affected)
        {
            this.RemoveOwnedNodes(member.id);
        }
        this.sourcesOf.set(memberId, [...sources]);
        for (const member of affected)
        {
            this.LoadMember(member, this.sourcesOf.get(member.id) ?? []);
        }
        this.RebuildDiagnostics();
        this.Changed.emit({ memberIds: affected.map(m => m.id) });
    }

    private LoadMember(member: SolutionGraphMember, sources: readonly SourceFile[]): void
    {
        const before = new Set(this.model.allNodes().map(n => n.id));
        const loadDiags = loadInto(this.model, [...sources], preludeNames(), this.idGen, this.provenance);
        this.loadDiagsByMember.set(member.id, loadDiags);
        const origin = WikiLocator.OpenProjectOrigin(member.storage);
        for (const node of this.model.allNodes())
        {
            if (before.has(node.id))
            {
                continue;
            }
            this.memberOf.set(node.id, member.id);
            if (!this.originOf.has(node.id))
            {
                this.originOf.set(node.id, origin);
            }
        }
    }

    private RemoveOwnedNodes(memberId: string): void
    {
        const owned = [...this.memberOf].filter(([, m]) => m === memberId).map(([id]) => id);
        for (const id of owned)
        {
            this.model.remove(id);
            this.provenance.delete(id);
            this.originOf.delete(id);
            this.memberOf.delete(id);
        }
    }

    private RebuildDiagnostics(): void
    {
        this.diagnosticsByUri = new Map();
        for (const diags of this.loadDiagsByMember.values())
        {
            this.AddDiagnostics(diags);
        }
        this.AddDiagnostics(validate(this.model));
    }

    private AddDiagnostics(diags: readonly Diagnostic[]): void
    {
        for (const d of diags)
        {
            const key = d.span?.uri ?? SolutionGraph.ModelScopeUri;
            const list = this.diagnosticsByUri.get(key);
            if (list)
            {
                list.push(d);
            }
            else
            {
                this.diagnosticsByUri.set(key, [d]);
            }
        }
    }

    private DistinctBases(members: readonly SolutionGraphMember[]): TodlDocument[]
    {
        const seen = new Set<TodlDocument>();
        for (const m of members)
        {
            for (const b of m.publishedBases)
            {
                seen.add(b);
            }
        }
        return [...seen];
    }

    private TopoOrder(members: readonly SolutionGraphMember[]): SolutionGraphMember[]
    {
        const byId = new Map<string, SolutionGraphMember>();
        for (const m of members)
        {
            if (byId.has(m.id))
            {
                throw new Error(`${SolutionGraph.DuplicateIdMessage}: ${m.id}`);
            }
            byId.set(m.id, m);
        }
        const visited = new Set<string>();
        const stack: string[] = [];
        const order: SolutionGraphMember[] = [];
        const visit = (m: SolutionGraphMember): void =>
        {
            const at = stack.indexOf(m.id);
            if (at >= 0)
            {
                const cycle = [...stack.slice(at), m.id].join(SolutionGraph.CycleSeparator);
                throw new Error(`${SolutionGraph.CycleMessage}: ${cycle}`);
            }
            if (visited.has(m.id))
            {
                return;
            }
            visited.add(m.id);
            stack.push(m.id);
            for (const baseId of m.baseIds)
            {
                const base = byId.get(baseId);
                if (base)
                {
                    visit(base);
                }
            }
            stack.pop();
            order.push(m);
        };
        for (const m of members)
        {
            visit(m);
        }
        return order;
    }
}
