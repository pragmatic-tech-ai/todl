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

// The mutable state a built graph holds — the composed model plus the per-node and
// per-member bookkeeping — in one bag, so a full Build can assemble a FRESH bag locally
// and swap it in atomically only after it fully succeeds. A throw mid-build then leaves
// the PRIOR bag intact. ReplaceMember mutates the live bag in place.
interface GraphState
{
    model: Repository;
    provenance: Map<string, string>;
    memberOf: Map<string, string>;
    originOf: Map<string, WikiOrigin>;
    sourcesOf: Map<string, SourceFile[]>;
    diagnosticsByUri: Map<string, Diagnostic[]>;
    membersById: Map<string, SolutionGraphMember>;
    loadDiagsByMember: Map<string, Diagnostic[]>;
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
    private state: GraphState = SolutionGraph.FreshState();

    public readonly Changed: Signal<SolutionGraphChange> = new Signal<SolutionGraphChange>();

    // A fresh, empty state whose model is prelude + the given published bases merged once.
    private static FreshState(bases: readonly TodlDocument[] = []): GraphState
    {
        return {
            model: new Repository(mergeBases([preludeDocument(), ...bases])),
            provenance: new Map(),
            memberOf: new Map(),
            originOf: new Map(),
            sourcesOf: new Map(),
            diagnosticsByUri: new Map(),
            membersById: new Map(),
            loadDiagsByMember: new Map(),
        };
    }

    public get Model(): Repository
    {
        return this.state.model;
    }

    public get OriginOf(): ReadonlyMap<string, WikiOrigin>
    {
        return this.state.originOf;
    }

    /** True once `memberId` has been built into the graph (so ReplaceMember is safe). */
    public Has(memberId: string): boolean
    {
        return this.state.membersById.has(memberId);
    }

    public DiagnosticsByUri(): ReadonlyMap<string, Diagnostic[]>
    {
        return this.state.diagnosticsByUri;
    }

    public async Build(members: readonly SolutionGraphMember[]): Promise<void>
    {
        // Order FIRST: a duplicate id / cycle throws here, before any state is assembled,
        // so the prior graph stays intact. The rest builds into a LOCAL bag and is swapped
        // in only after every loadInto + validate succeeds, so a throw anywhere mid-build
        // likewise leaves the prior graph untouched.
        const ordered = this.TopoOrder(members);
        const state = SolutionGraph.FreshState(this.DistinctBases(members));
        for (const member of ordered)
        {
            state.membersById.set(member.id, member);
            state.sourcesOf.set(member.id, [...member.sources]);
            this.LoadMember(state, member, member.sources);
        }
        this.RebuildDiagnostics(state);
        // Commit atomically only after the whole build succeeded, then notify: a subscriber
        // holding the old Repository must learn its view was swapped (empty id list clears).
        this.state = state;
        this.Changed.emit({ memberIds: [...state.membersById.keys()] });
    }

    /** Members whose baseIds include `memberId`, transitively. */
    public DependentsOf(memberId: string): readonly string[]
    {
        const found = new Set<string>();
        const queue: string[] = [memberId];
        while (queue.length > 0)
        {
            const current = queue.shift() as string;
            for (const m of this.state.membersById.values())
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
        const state = this.state;
        if (!state.membersById.has(memberId))
        {
            throw new Error(`${SolutionGraph.UnknownMemberMessage}: ${memberId}`);
        }
        const affectedSet = new Set<string>([memberId, ...this.DependentsOf(memberId)]);
        const affected = this.TopoOrder([...state.membersById.values()])
            .filter(m => affectedSet.has(m.id));

        for (const member of affected)
        {
            this.RemoveOwnedNodes(state, member.id);
        }
        state.sourcesOf.set(memberId, [...sources]);
        for (const member of affected)
        {
            this.LoadMember(state, member, state.sourcesOf.get(member.id) ?? []);
        }
        this.RebuildDiagnostics(state);
        this.Changed.emit({ memberIds: affected.map(m => m.id) });
    }

    private LoadMember(state: GraphState, member: SolutionGraphMember, sources: readonly SourceFile[]): void
    {
        const before = new Set(state.model.allNodes().map(n => n.id));
        const loadDiags = loadInto(state.model, [...sources], preludeNames(), this.idGen, state.provenance);
        state.loadDiagsByMember.set(member.id, loadDiags);
        const origin = WikiLocator.OpenProjectOrigin(member.storage);
        for (const node of state.model.allNodes())
        {
            if (before.has(node.id))
            {
                continue;
            }
            state.memberOf.set(node.id, member.id);
            if (!state.originOf.has(node.id))
            {
                state.originOf.set(node.id, origin);
            }
        }
    }

    private RemoveOwnedNodes(state: GraphState, memberId: string): void
    {
        const owned = [...state.memberOf].filter(([, m]) => m === memberId).map(([id]) => id);
        for (const id of owned)
        {
            state.model.remove(id);
            state.provenance.delete(id);
            state.originOf.delete(id);
            state.memberOf.delete(id);
        }
    }

    private RebuildDiagnostics(state: GraphState): void
    {
        state.diagnosticsByUri = new Map();
        for (const diags of state.loadDiagsByMember.values())
        {
            this.AddDiagnostics(state, diags);
        }
        this.AddDiagnostics(state, validate(state.model));
    }

    private AddDiagnostics(state: GraphState, diags: readonly Diagnostic[]): void
    {
        for (const d of diags)
        {
            const key = d.span?.uri ?? SolutionGraph.ModelScopeUri;
            const list = state.diagnosticsByUri.get(key);
            if (list)
            {
                list.push(d);
            }
            else
            {
                state.diagnosticsByUri.set(key, [d]);
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
