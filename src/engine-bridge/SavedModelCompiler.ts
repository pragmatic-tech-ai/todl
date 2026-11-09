import { checkAgainst } from '../compiler-services/api.js';
import { toJSON, type TodlDocument } from '../compiler-services/emit/json.js';
import { ManifestEmitter, type DataEdge, type DataNode } from '../compiler-services/emit/manifest.js';
import type { SourceFile } from '../compiler-services/diagnostics/span.js';
import { DiagnosticCode, Severity, type Diagnostic } from '../compiler-services/diagnostics/diagnostic.js';
import type { Repository } from '../compiler-services/model/model.js';
import { MetadataSnapshot } from '../domain/metadata-snapshot.js';
import { Manifest } from '../manifest/reflection/reflection.js';
import { ManifestWriter } from '../manifest/manifest-writer.js';
import { ModelShardExtractor } from '../model-data/model-shard-extractor.js';
import { PackageManifestBridge } from '../solution-services/package-manager/package-manifest-bridge.js';
import { MessageFormat } from './MessageFormat.js';

/** One saved model of a solution: its model id (the TODL `model` declaration's node id) and the saved sources of its member. */
export interface ISavedModel
{
    /** The model container's node id, as {@link ModelShardExtractor.ModelsOf} keys it (e.g. `shop.Orders`). */
    ModelId: string;
    /** The model's namespace: the `ModelId` prefix, or else the solution name. Carried for the workspace; Compile keys by `ModelId`. */
    Namespace: string;
    /** The member's SAVED `.todl` sources (never editor buffers). Sources shared between models are compiled once, by uri. */
    Sources: readonly SourceFile[];
}

/** The compiled saved sources: one package per model id over a fresh snapshot, the repository, and the compile diagnostics. */
export interface ISavedSnapshot
{
    Snapshot: MetadataSnapshot;
    Repository: Repository;
    Diagnostics: readonly Diagnostic[];
}

/** A package of the saved snapshot: its model id and the seed nodes and edges it binds. */
class SavedPackage
{
    public readonly Nodes: DataNode[] = [];
    public readonly Edges: DataEdge[] = [];
    public readonly DependsOn = new Set<string>();

    public constructor(public readonly Model: string) {}
}

/**
 * Compiles a solution's SAVED `.todl` sources into one {@link MetadataSnapshot} with one package per model id, so the
 * home package (`HomeModelOf`) of every instance is the model that declares it. Instances outside every given model
 * (including base-library instances) go to a package named by the solution. Packages are bound deps-first: the
 * solution package, then each model after the models its instances reference.
 */
export class SavedModelCompiler
{
    private static readonly Version = '0.0.0';
    private static readonly SolutionCollisionMessage = 'Saved model "{0}" has the solution\'s name; it gets no package and its instances go to the solution package';
    private static readonly UndeclaredMessage = 'Saved model "{0}" is declared by none of the saved sources; it gets no package';
    private static readonly DuplicateMessage = 'Saved model "{0}" is listed more than once; the first entry is used';

    /**
     * A model id equal to `solutionName` (ruling F-d: the two packages would be one, and solution-owned instances
     * would read as that model's), a model id no saved source declares, and one listed twice are each reported in
     * `Diagnostics` as a warning and skipped: that model gets no package, so its instances fall to the solution package.
     */
    public static Compile(models: readonly ISavedModel[], bases: readonly TodlDocument[], solutionName: string): ISavedSnapshot
    {
        const compiled = checkAgainst([...bases], SavedModelCompiler.SourcesOf(models));
        const diagnostics: Diagnostic[] = [...compiled.diagnostics];
        const repository = compiled.model;
        const { manifest, graph } = new ManifestEmitter(repository, solutionName, SavedModelCompiler.Version).emit();
        const packages = SavedModelCompiler.Partition(repository, models, solutionName, graph.nodes, graph.edges, diagnostics);
        const ordered = SavedModelCompiler.DepsFirst(packages, solutionName);
        const snapshot = new MetadataSnapshot();
        for (const pkg of ordered)
        {
            const reflected = Manifest.load(ManifestWriter.fromLogical({ ...manifest, model: pkg.Model }).toBinary());
            snapshot.PreRegister(reflected);
            snapshot.Finalize(reflected);
        }
        for (const pkg of ordered)
        {
            // A saved file that does not compile can leave instances of undeclared types; they cannot bind, and the
            // compile diagnostics already report why.
            const nodes = pkg.Nodes.filter((n) => snapshot.ownerOf(n.type) !== undefined);
            const bound = new Set(nodes.map((n) => n.id));
            const seed = PackageManifestBridge.seedOf({
                manifestRef: { model: pkg.Model, version: SavedModelCompiler.Version },
                nodes,
                edges: pkg.Edges.filter((e) => bound.has(e.from)),
            });
            snapshot.BindSeed(seed, { model: pkg.Model, version: SavedModelCompiler.Version });
        }
        return { Snapshot: snapshot, Repository: repository, Diagnostics: diagnostics };
    }

    /** The union of every model's sources, each uri once (models of one member share its files). */
    private static SourcesOf(models: readonly ISavedModel[]): SourceFile[]
    {
        const byUri = new Map<string, SourceFile>();
        for (const model of models)
        {
            for (const source of model.Sources)
            {
                if (!byUri.has(source.uri)) byUri.set(source.uri, { uri: source.uri, text: source.text });
            }
        }
        return [...byUri.values()];
    }

    /**
     * Splits the emitted seed into the solution package and one package per given model; an edge goes with its source
     * node. A model id equal to the solution name, a duplicate or an undeclared one gets a warning and no package.
     */
    private static Partition(repository: Repository, models: readonly ISavedModel[], solutionName: string,
        nodes: readonly DataNode[], edges: readonly DataEdge[], diagnostics: Diagnostic[]): Map<string, SavedPackage>
    {
        const packages = new Map<string, SavedPackage>([[solutionName, new SavedPackage(solutionName)]]);
        const homeOf = new Map<string, SavedPackage>();
        const doc = toJSON(repository);
        const declared = new Set(ModelShardExtractor.ModelsOf(doc));
        for (const model of models)
        {
            if (model.ModelId === solutionName)
            {
                diagnostics.push(SavedModelCompiler.Warning(DiagnosticCode.SavedModelSolutionCollision, SavedModelCompiler.SolutionCollisionMessage, model.ModelId));
                continue;
            }
            if (packages.has(model.ModelId))
            {
                diagnostics.push(SavedModelCompiler.Warning(DiagnosticCode.SavedModelDuplicate, SavedModelCompiler.DuplicateMessage, model.ModelId));
                continue;
            }
            if (!declared.has(model.ModelId))
            {
                diagnostics.push(SavedModelCompiler.Warning(DiagnosticCode.SavedModelUndeclared, SavedModelCompiler.UndeclaredMessage, model.ModelId));
                continue;
            }
            const pkg = new SavedPackage(model.ModelId);
            packages.set(model.ModelId, pkg);
            for (const node of ModelShardExtractor.Extract(doc, model.ModelId).nodes)
            {
                if (node.tier === ModelShardExtractor.InstanceTier && !homeOf.has(node.id)) homeOf.set(node.id, pkg);
            }
        }
        const solution = packages.get(solutionName)!;
        for (const node of nodes) (homeOf.get(node.id) ?? solution).Nodes.push(node);
        for (const edge of edges)
        {
            const from = homeOf.get(edge.from) ?? solution;
            const to = homeOf.get(edge.to) ?? solution;
            from.Edges.push(edge);
            if (to !== from && from !== solution) from.DependsOn.add(to.Model);
        }
        return packages;
    }

    /** A whole-model warning about one saved model id. */
    private static Warning(code: DiagnosticCode, template: string, modelId: string): Diagnostic
    {
        return { code, severity: Severity.Warning, message: MessageFormat.Format(template, modelId), span: null, node: modelId, path: null };
    }

    /** The packages in dependency order: the solution package first, then a stable post-order over model references (a cycle keeps input order). */
    private static DepsFirst(packages: ReadonlyMap<string, SavedPackage>, solutionName: string): SavedPackage[]
    {
        const ordered: SavedPackage[] = [packages.get(solutionName)!];
        const visited = new Set<string>([solutionName]);
        for (const pkg of packages.values()) SavedModelCompiler.Visit(pkg, packages, visited, ordered);
        return ordered;
    }

    private static Visit(pkg: SavedPackage, packages: ReadonlyMap<string, SavedPackage>, visited: Set<string>, ordered: SavedPackage[]): void
    {
        if (visited.has(pkg.Model)) return;
        visited.add(pkg.Model);
        for (const dep of pkg.DependsOn)
        {
            const target = packages.get(dep);
            if (target !== undefined) SavedModelCompiler.Visit(target, packages, visited, ordered);
        }
        ordered.push(pkg);
    }
}
