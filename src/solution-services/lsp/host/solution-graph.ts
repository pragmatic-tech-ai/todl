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

    /** nodeId → full source-file URI that authored the node. */
    public get Provenance(): ReadonlyMap<string, string>
    {
        return this.state.provenance;
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
        this.BuildInternal(members);
    }

    // The transactional build core shared by Build and the ReplaceMember repair path:
    // order FIRST (a duplicate id / cycle throws here, before any state is assembled, so
    // the prior graph stays intact), assemble into a LOCAL bag, and swap it in only after
    // every loadInto + validate succeeds — a throw anywhere mid-build likewise leaves the
    // prior graph untouched. On success, emit with every member id built (empty clears).
    private BuildInternal(members: readonly SolutionGraphMember[]): void
    {
        const ordered = this.TopoOrder(members);
        const state = SolutionGraph.FreshState(this.DistinctBases(members));
        for (const member of ordered)
        {
            state.membersById.set(member.id, member);
            state.sourcesOf.set(member.id, [...member.sources]);
            this.LoadMember(state, member, member.sources);
        }
        this.RebuildDiagnostics(state);
        this.state = state;
        this.Changed.emit({ memberIds: [...state.membersById.keys()] });
    }

    // A transactional full rebuild from the CURRENT member set, each member's sources
    // taken from the live sourcesOf map (so in-flight edits are honored). Reuses
    // BuildInternal, so a throw leaves the prior graph intact. The repair path for a
    // failed incremental ReplaceMember.
    private RebuildFromState(): void
    {
        const members = [...this.state.membersById.values()].map(
            (m) => ({ ...m, sources: this.state.sourcesOf.get(m.id) ?? m.sources }));
        this.BuildInternal(members);
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
        // Capture the member's last-good sources, then record the edit up front so BOTH the
        // incremental path below and any repair rebuild honor it.
        const priorSources = [...(state.sourcesOf.get(memberId) ?? [])];
        state.sourcesOf.set(memberId, [...sources]);
        const affectedSet = new Set<string>([memberId, ...this.DependentsOf(memberId)]);
        const affected = this.TopoOrder([...state.membersById.values()])
            .filter(m => affectedSet.has(m.id));

        try
        {
            // Incremental happy path: strip + reload only the affected members in place.
            for (const member of affected)
            {
                this.RemoveOwnedNodes(state, member.id);
            }
            for (const member of affected)
            {
                this.LoadMember(state, member, state.sourcesOf.get(member.id) ?? []);
            }
            this.RebuildDiagnostics(state);
        }
        catch
        {
            // loadInto can throw mid-reload (e.g. builder.commit "node already exists" on a
            // duplicate declaration while typing), leaving `state` half-stripped. Repair to
            // a consistent graph via a transactional rebuild (which fires its own single
            // Changed) so no nodes silently vanish, then RETURN — the happy-path emit below
            // must not also run.
            this.RepairFailedReplace(memberId, priorSources);
            return;
        }
        // Emit OUTSIDE the try so a throwing GraphChanged subscriber cannot be caught as a
        // "load failure" and trip RepairFailedReplace (which would revert the user's edit).
        // Reached only after a clean incremental replace — exactly one emit on this path.
        this.Changed.emit({ memberIds: affected.map(m => m.id) });
    }

    // Repair the graph after a failed incremental ReplaceMember. First try a transactional
    // rebuild honoring the edit (sources already in sourcesOf); if the edit itself is
    // uncompilable that rebuild throws too, so fall back to rebuilding from the member's
    // last-good sources, which is known to compile. Either way `this.state` ends consistent
    // and a Changed event has fired.
    private RepairFailedReplace(memberId: string, priorSources: readonly SourceFile[]): void
    {
        try
        {
            this.RebuildFromState();
        }
        catch
        {
            this.state.sourcesOf.set(memberId, [...priorSources]);
            this.RebuildFromState();
        }
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
