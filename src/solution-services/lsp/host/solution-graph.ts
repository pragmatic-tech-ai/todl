import { Signal, type IStorage } from '@pragmatic-tech-ai/todl-runtime';
import { mergeBases } from '../../../compiler-services/api.js';
import { loadInto } from '../../../compiler-services/parse/loader.js';
import { preludeDocument, preludeNames } from '../../../compiler-services/stdlib/prelude.js';
import { validate } from '../../../compiler-services/validate/validate.js';
import { Repository } from '../../../compiler-services/model/model.js';
import { SnowflakeIdGenerator, type IdGenerator } from '../../../compiler-services/model/id-generator.js';
import { DiagnosticCode, type Diagnostic } from '../../../compiler-services/diagnostics/diagnostic.js';
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
    /** Full source-file URIs whose nodes were (re)loaded by this change. */
    fileIds: readonly string[];
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
    // member id → (authoring file uri → that file's load diagnostics). Keyed per FILE so a
    // single-file reload (ReplaceFile) can replace exactly one file's load diagnostics while
    // preserving its sibling files', and a whole-member reload replaces the member's inner map.
    loadDiagsByMember: Map<string, Map<string, Diagnostic[]>>;
}

/**
 * One Repository for the whole open solution: prelude + published bases merged once,
 * every source member loaded in, bases shared (no per-member copy).
 */
export class SolutionGraph
{
    // The diagnostics-bucket key for whole-model (null-span) diagnostics. Public so the
    // host can lift this bucket out when assembling a per-project GraphSlice.
    public static readonly ModelScopeUri = '<model>';
    private static readonly DuplicateIdMessage = 'Duplicate solution member id';
    private static readonly CycleMessage = 'Solution member dependency cycle';
    private static readonly CycleSeparator = ' -> ';
    private static readonly UnknownMemberMessage = 'Unknown solution member id';
    private static readonly UnownedFileMessage = 'No solution member owns file';
    // Load-diagnostic codes a newly-defined node could clear: an unresolved name (or a reference
    // to a not-yet-defined declaration) re-resolves once its target exists. Drives
    // DanglingReferenceFiles — any owning file carrying one reloads when a reload adds ids.
    // COMPLETENESS: every LOADER-emitted (i.e. reaching loadDiagsByMember), cross-file-clearable
    // resolution-failure code MUST be listed — an omission leaks an add-direction stale
    // diagnostic. Listing is conservative: over-listing only reloads an extra sibling (always
    // equivalence-preserving), under-listing is a correctness bug. Validate-only codes (e.g.
    // ModelBindingUndefined) are deliberately absent — they never reach a load bucket.
    // Covers the split-taxonomy case too (a `represents` clause in one file, a nested term
    // record in another) via TermConceptNotRepresented.
    private static readonly ResolutionFailureCodes: ReadonlySet<DiagnosticCode> = new Set([
        DiagnosticCode.ReferenceUndefined,
        DiagnosticCode.ReferenceUnreachable,
        DiagnosticCode.TaxonomyUsesUndefined,
        DiagnosticCode.OperatorUndefined,
        DiagnosticCode.OperatorBadEndpoint,
        DiagnosticCode.ModelConformsNotViewpoint,
        DiagnosticCode.TermConceptNotRepresented,
        DiagnosticCode.InlineObjectTarget,
        DiagnosticCode.InlineObjectType,
    ]);

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

    /** True when some member's current source set already declares `fileUri` (so ReplaceFile is safe). */
    public HasFile(fileUri: string): boolean
    {
        for (const sources of this.state.sourcesOf.values())
        {
            if (sources.some(s => s.uri === fileUri))
            {
                return true;
            }
        }
        return false;
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
        const memberIds = [...state.membersById.keys()];
        this.Changed.emit({ memberIds, fileIds: this.FileIdsFor(state, new Set(memberIds)) });
    }

    // The distinct source-file URIs authoring nodes owned by any of the given members.
    private FileIdsFor(state: GraphState, memberIds: ReadonlySet<string>): string[]
    {
        const files = new Set<string>();
        for (const [nodeId, uri] of state.provenance)
        {
            const owner = state.memberOf.get(nodeId);
            if (owner !== undefined && memberIds.has(owner))
            {
                files.add(uri);
            }
        }
        return [...files];
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
        this.Changed.emit({ memberIds: affected.map(m => m.id), fileIds: this.FileIdsFor(state, affectedSet) });
    }

    // File-granular incremental reload. `memberSources` is the owning member's CURRENT full
    // source set; `fileUri` is the one file that changed. Strips exactly that file's nodes plus
    // any sibling file whose nodes reference the changed set (a fixpoint referrer cone — see the
    // loop below), reloads those, then strips+reloads every dependent member wholesale (their
    // cross-member references must re-resolve). Crash-safe like ReplaceMember: the incremental
    // mutation is wrapped in a try that repairs from last-good on throw; the emit is outside it.
    public ReplaceFile(fileUri: string, memberSources: readonly SourceFile[]): void
    {
        const state = this.state;
        const owningId = this.FindOwningMember(state, fileUri);
        const priorSources = [...(state.sourcesOf.get(owningId) ?? [])];
        state.sourcesOf.set(owningId, [...memberSources]);

        const dependentIds = this.DependentsOf(owningId);
        const dependents = this.TopoOrder([...state.membersById.values()])
            .filter(m => dependentIds.includes(m.id));

        const reloadedFiles = new Set<string>([fileUri]);
        const memberIds = new Set<string>([owningId, ...dependentIds]);
        try
        {
            // Owning member: strip + reload the changed file, then widen to any sibling file that
            // references the changed set — by edge, instance-type, class, concept-field /
            // annotation-param type, or a reference-bearing ATTR (`conforms`). A rename/remove is
            // caught by the files' PRIOR ids; an ADD by the NEW ids a reload mints (a sibling's
            // stale `x : T` / undefined `conforms` now resolves). The cone is a FIXPOINT over
            // prior ∪ current ids of everything reloaded so far. The ENTIRE cone is re-stripped and
            // reloaded TOGETHER each round (not just the newly-added files): a file reloaded in an
            // earlier round may own an edge INTO a file added in a later round, and stripping that
            // later file drops the earlier edge — only a joint reload re-mints both ends.
            const owning = state.membersById.get(owningId) as SolutionGraphMember;
            // A sibling's reference to a not-yet-defined symbol is stored UNRESOLVED (the bare
            // name, absent from the model), so it cannot be matched by a newly-minted qualified
            // id. Snapshot the pre-edit id set: when a reload ADDS ids, every owning file holding
            // an unresolved-reference load diagnostic must reload so its bare name can re-resolve.
            // A pure removal adds nothing and cannot satisfy a dangling reference.
            const idsBefore = new Set(state.model.allNodes().map(n => n.id));
            const priorIdsByFile = new Map<string, Set<string>>();
            for (const [id, uri] of state.provenance)
            {
                if (state.memberOf.get(id) === owningId)
                {
                    (priorIdsByFile.get(uri) ?? priorIdsByFile.set(uri, new Set()).get(uri) as Set<string>).add(id);
                }
            }
            while (true)
            {
                for (const uri of reloadedFiles)
                {
                    this.RemoveOwnedFile(state, uri);
                }
                const subset = memberSources.filter(s => reloadedFiles.has(s.uri));
                const loadDiags = this.LoadSources(state, owning, subset);
                this.AttributeLoadDiags(state, owningId, reloadedFiles, loadDiags, false);
                const seed = new Set<string>();
                for (const uri of reloadedFiles)
                {
                    for (const id of priorIdsByFile.get(uri) ?? [])
                    {
                        seed.add(id);
                    }
                }
                for (const [id, uri] of state.provenance)
                {
                    if (reloadedFiles.has(uri))
                    {
                        seed.add(id);
                    }
                }
                const widen = this.ReferrerFiles(state, owningId, seed);
                if (state.model.allNodes().some(n => !idsBefore.has(n.id)))
                {
                    for (const uri of this.DanglingReferenceFiles(state, owningId))
                    {
                        widen.add(uri);
                    }
                }
                const before = reloadedFiles.size;
                for (const uri of widen)
                {
                    reloadedFiles.add(uri);
                }
                if (reloadedFiles.size === before)
                {
                    break;
                }
            }

            // Dependent members: whole strip + reload in topological order.
            for (const member of dependents)
            {
                this.RemoveOwnedNodes(state, member.id);
            }
            for (const member of dependents)
            {
                this.LoadMember(state, member, state.sourcesOf.get(member.id) ?? []);
                for (const s of state.sourcesOf.get(member.id) ?? [])
                {
                    reloadedFiles.add(s.uri);
                }
            }
            this.RebuildDiagnostics(state);
        }
        catch
        {
            this.RepairFailedReplace(owningId, priorSources);
            return;
        }
        this.Changed.emit({ memberIds: [...memberIds], fileIds: [...reloadedFiles] });
    }

    // The owning member of a file: the one whose CURRENT source set declares that uri. Searched
    // before the edit is recorded, so the changed file is still present in its member's sources.
    private FindOwningMember(state: GraphState, fileUri: string): string
    {
        for (const [memberId, sources] of state.sourcesOf)
        {
            if (sources.some(s => s.uri === fileUri))
            {
                return memberId;
            }
        }
        throw new Error(`${SolutionGraph.UnownedFileMessage}: ${fileUri}`);
    }

    // The owning member's files (excluding the changed file itself) whose nodes transitively
    // reference `seedIds` — they must reload so their references re-resolve against the re-minted
    // nodes. Walks the referrer frontier over the live graph (Repository exposes only forward
    // edges, so referrers are found by scanning outEdges), then homes each referrer to its file.
    private ReferrerFiles(state: GraphState, memberId: string, seedIds: ReadonlySet<string>): Set<string>
    {
        const referrers = new Set<string>();
        let frontier = new Set<string>(seedIds);
        while (frontier.size > 0)
        {
            const next = new Set<string>();
            for (const node of state.model.allNodes())
            {
                if (referrers.has(node.id) || seedIds.has(node.id))
                {
                    continue;
                }
                // A node references a seed by instance-type, class-origin, a concept FIELD /
                // annotation PARAM type (both stored on node.fields[].type, edge-free), a
                // reference-bearing ATTR whose value is a node id (e.g. `conforms` → a viewpoint
                // id, edge-free and not a field), or any out-edge target — InstanceOf/class/field/
                // conforms links live on the node, not as edges.
                const refs =
                    (node.type !== null && frontier.has(node.type)) ||
                    (node.class !== null && frontier.has(node.class)) ||
                    node.fields.some(f => frontier.has(f.type)) ||
                    [...node.attrs.values()].some(v => typeof v === 'string' && frontier.has(v)) ||
                    state.model.outEdges(node.id).some(e => frontier.has(String(e.to)));
                if (refs)
                {
                    referrers.add(node.id);
                    next.add(node.id);
                }
            }
            frontier = next;
        }
        const files = new Set<string>();
        for (const id of referrers)
        {
            if (state.memberOf.get(id) === memberId)
            {
                const uri = state.provenance.get(id);
                if (uri !== undefined)
                {
                    files.add(uri);
                }
            }
        }
        return files;
    }

    // The owning member's files that hold at least one UNRESOLVED-reference load diagnostic.
    // The loader stores an undefined reference as its raw (unqualified) name, so it can't be
    // matched by a freshly-minted qualified id — but the file's own `reference.*` diagnostic is a
    // precise flag (and avoids the primitive-type false positives a structural `!has` would hit).
    // Such a file must reload when the graph gains ids, since its bare name may now resolve.
    private DanglingReferenceFiles(state: GraphState, memberId: string): Set<string>
    {
        const files = new Set<string>();
        const byFile = state.loadDiagsByMember.get(memberId);
        if (byFile === undefined)
        {
            return files;
        }
        for (const [uri, diags] of byFile)
        {
            if (diags.some(d => SolutionGraph.ResolutionFailureCodes.has(d.code)))
            {
                files.add(uri);
            }
        }
        return files;
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
        // Whole-member (re)load: a FRESH inner diagnostics map replaces the member's old one,
        // so a dropped/renamed file's stale load diagnostics vanish with it.
        const loadDiags = this.LoadSources(state, member, sources);
        this.AttributeLoadDiags(state, member.id, new Set(sources.map(s => s.uri)), loadDiags, true);
    }

    // Load one member's `sources` (a full set or a single-file subset) into the live model in
    // one loadInto pass — so a subset's mutual forward references resolve — attributing every
    // newly-minted node to `member`. Returns the load diagnostics for the caller to bucket.
    private LoadSources(state: GraphState, member: SolutionGraphMember, sources: readonly SourceFile[]): Diagnostic[]
    {
        const before = new Set(state.model.allNodes().map(n => n.id));
        const loadDiags = loadInto(state.model, [...sources], preludeNames(), this.idGen, state.provenance);
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
        return loadDiags;
    }

    // Bucket a load pass's diagnostics into the member's per-file map. Each diagnostic is homed
    // by its span uri, else by its offending node's provenance, else the model scope. When
    // `fresh`, the member's inner map is rebuilt from scratch (whole-member reload); otherwise
    // only the `reloaded` files' buckets are cleared first, leaving sibling files untouched
    // (single-file reload). Every reloaded file is given a bucket so an empty reload clears it.
    private AttributeLoadDiags(
        state: GraphState, memberId: string, reloaded: ReadonlySet<string>, diags: readonly Diagnostic[], fresh: boolean): void
    {
        const inner = fresh ? new Map<string, Diagnostic[]>() : (state.loadDiagsByMember.get(memberId) ?? new Map<string, Diagnostic[]>());
        for (const uri of reloaded)
        {
            inner.set(uri, []);
        }
        for (const d of diags)
        {
            const home = d.span?.uri ?? (d.node !== null ? state.provenance.get(d.node) : undefined) ?? SolutionGraph.ModelScopeUri;
            const list = inner.get(home);
            if (list)
            {
                list.push(d);
            }
            else
            {
                inner.set(home, [d]);
            }
        }
        state.loadDiagsByMember.set(memberId, inner);
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

    // Strip every node (and, via model.remove, its edges) authored by a single file, keyed on
    // provenance. Mirrors RemoveOwnedNodes but at file granularity — the strip half of
    // ReplaceFile, so a changed file's nodes can be re-minted without touching sibling files.
    private RemoveOwnedFile(state: GraphState, fileUri: string): void
    {
        const owned = [...state.provenance].filter(([, uri]) => uri === fileUri).map(([id]) => id);
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
        for (const byFile of state.loadDiagsByMember.values())
        {
            for (const diags of byFile.values())
            {
                this.AddDiagnostics(state, diags);
            }
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
