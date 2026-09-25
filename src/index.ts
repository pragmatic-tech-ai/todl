/** Public API for `@pragmatic-tech-ai/todl`. */

export { Signal, type Disposable } from '@pragmatic-tech-ai/todl-runtime';
export {
    Ask,
    ConfirmAsk,
    PickFolderAsk,
    PickFileAsk,
    PromptTextAsk,
    ChooseAsk,
    type FileFilter,
    type Choice,
    type IPromptService,
} from '@pragmatic-tech-ai/todl-runtime';

export {
    Graph,
    Tier,
    EdgeKind,
    Direction,
    Cardinality,
    GraphChangeKind,
    type NodeId,
    type Scalar,
    type Node,
    type Edge,
    type GraphChangeArgs,
} from './compiler-services/model/graph.js';

export { InMemoryGraphStore, type GraphStore } from './compiler-services/model/graph-store.js';

export {
    CypherGraphStore,
    type CypherSession,
    type CypherOp,
    type CypherRow,
} from './compiler-services/model/cypher-store.js';

export {
    ReactiveNode,
    PropertyChangeKind,
    CollectionChangeKind,
    type PropertyChangedArgs,
    type CollectionChangedArgs,
    type INotifyPropertyChanged,
    type INotifyCollectionChanged,
} from './compiler-services/model/reactive.js';

export { Builder, type TermInput } from './compiler-services/model/builder.js';
export { MetaKind } from './compiler-services/model/kinds.js';

export {
    Repository,
    type FieldSchema,
    type RelationshipSchema,
    type ConceptSchema,
} from './compiler-services/model/model.js';

export { EntityBase, type Entity } from './compiler-services/model/entity.js';

export {
    ReflectedRepository,
    ReflectedEntity,
    type EntityReader,
} from './reflection-client/index.js';

export { ModelDataSource } from './model-data/model-data-source.js';
export { DocumentModelDataConnector } from './model-data/document-model-data-connector.js';
export { type IModelDataConnector } from './model-data/model-data-connector.js';
export { BundledModelDataConnector } from './model-data/bundled-model-data-connector.js';
export { ModelRegistry } from './model-data/model-registry.js';
export { ModelShardExtractor } from './model-data/model-shard-extractor.js';
export { ApplicationRootResolver } from './model-data/application-root-resolver.js';
export { GenericModelDataSource } from './model-data/generic-model-data-source.js';
export { BundledModelRegistry, type BundledAppPayload } from './model-data/bundled-model-registry.js';

export { ApplicationBootstrapper } from './application/application-bootstrapper.js';
export { ApplicationEntryPoint } from './application/application-entry-point.js';
export { ModelRegistryContribution } from './application/model-registry-contribution.js';
export type { IContributionSource } from './application/contribution-source.js';
export { MuralHost } from './application/mural-host.js';
export { TodlAppBootstrap } from './graph-api/browser/todl-app-bootstrap.js';
export { MuralViewContribution } from './application/mural-view-contribution.js';
export { ModelBrowserVM, ConceptHeaderVM, InstanceRowVM } from './application/model-browser-vm.js';

export {
    generateReadClient,
    isReferenceType,
    type ReadClientOptions,
} from './codegen/read-client.js';

export { ModelPackageGenerator } from './codegen/model-package.js';
export type { ModelPackageOptions } from './codegen/model-package.js';

export { ModelDraft, type InstanceDescriptor } from './authoring/model-draft.js';

export { TodlFileStore, type FileIO } from './authoring/file-store.js';
export { deriveBindings, emitModelTodl, type ModelBindings } from './compiler-services/emit/todl.js';

export {
    compilePackage,
    publish,
    PackageKind,
    type PackageRef,
    type PackageIdentity,
    type PackageDocument,
    type PackageResource,
    type CompiledPackage,
    type CompileOutcome,
    type PublishOutcome,
} from './publish/publish.js';
export {
    BlobPackageStore,
    GraphPackageStore,
    type PackageStore,
    type PackageSink,
} from './publish/stores.js';
export { deriveClasses, projectAnnotations } from './publish/reflect.js';
export { StoragePackageSource } from './solution-services/package-manager/storage-package-source.js';

export {
    ExprKind,
    BinaryOp,
    UnaryOp,
    QuantifierKind,
    THIS,
    NONE,
    variable,
    member,
    comprehension,
    all,
    any,
    and,
    or,
    implies,
    eq,
    neq,
    isIn,
    not,
    type Expr,
} from './compiler-services/predicate/ast.js';

export { evaluate, satisfies, type EvalValue } from './compiler-services/predicate/evaluate.js';

export { validate } from './compiler-services/validate/validate.js';
export { Severity, DiagnosticCode, type Diagnostic } from './compiler-services/diagnostics/diagnostic.js';
export type { Position, SourceSpan, SourceFile } from './compiler-services/diagnostics/span.js';
export { check, checkAgainst } from './compiler-services/api.js';

export {
    toJSON,
    toJSONOwn,
    fromJSON,
    graphFromJSON,
    type TodlDocument,
    type JsonNode,
    type JsonEdge,
    type EmitOptions,
    type NodeDebug,
    type EdgeDebug,
} from './compiler-services/emit/json.js';

export { toMetaModule, type MetaModuleOptions } from './compiler-services/emit/js-module.js';

export { rewrite } from './migrate/rewriter.js';

export { load, type LoadResult } from './compiler-services/parse/loader.js';
export { parse, type ParseResult } from './compiler-services/parse/parser.js';
export { parsePredicate } from './compiler-services/parse/predicate-parser.js';
export { tokenize, TokenKind, type Token } from './compiler-services/parse/lexer.js';

// ── Solution (SolutionManager + cross-project settings) ──
// The engine composition module is authored in .mu (a plain `module` → a headless
// Module) and compiled to .mu.js by `npm run compile:mu`.
export { SolutionServicesEngine } from './solution-services/solution-services-module.mu.js';
export { SolutionManagerService } from './solution-services/solution-manager/engine/solution-manager-service.js';
export {
    ProjectFactoryRegistryKey,
    type IStorageProviderRegistry,
    type IProjectFactoryRegistry,
} from './solution-services/solution-manager/engine/host-services.js';
export { ProjectFactoryRegistry } from './solution-services/solution-manager/engine/project-factory-registry.js';
export { type INotificationService } from './solution-services/solution-manager/engine/notification-service.js';
export { SolutionSettingsRegistry } from './solution-services/solution-manager/engine/solution-settings-registry.js';
export { SettingBagDefinition } from './solution-services/solution-manager/engine/setting-bag-definition.js';
export { SolutionSettingBag } from './solution-services/solution-manager/engine/solution-setting-bag.js';
export { Solution } from './solution-services/solution-manager/engine/solution.js';
export { SolutionSession } from './solution-services/solution-manager/engine/solution-session.js';
export { SolutionMember } from './solution-services/solution-manager/engine/solution-member.js';
export { SolutionManifest } from './solution-services/solution-manager/engine/solution-manifest.js';
export { type SolutionMemberRef, SolutionPath } from './solution-services/solution-manager/engine/solution-member-ref.js';
export {
    SolutionTreeVM,
    SolutionNodeVM,
    SolutionMemberNodeVM,
    type MemberStorageFor,
} from './solution-services/solution-manager/presentation/solution-tree-vm.js';
export { SettingBagGrid } from './solution-services/solution-manager/presentation/setting-bag-grid.js';
export {
    type IProjectFactory,
    type MemberStorageResolver,
    type ProjectFactoryResolver,
} from './solution-services/solution-manager/engine/project-factory.js';

// ── Projects (headless Project model + factory contracts + TODL-authoring base) ──
export { Project, ProjectNode, ProjectNodeKind } from './solution-services/project-services/core/project.js';
export {
    PROJECT_MANIFEST_FILENAME,
    ProducerKind,
    isPublishable,
    canGeneratePresentation,
    isVersioned,
    type ProjectManifestEnvelope,
    type ProjectFileFormat,
    type PublishResult,
    type IPublishableProjectFactory,
    type IPresentationProjectFactory,
    type IVersionedProjectFactory,
} from './solution-services/project-services/core/project-factory.js';
export { type PublishedBaseModelReference, type ProjectBaseModelBindings } from './solution-services/project-services/core/base-binding.js';
export {
    TodlProjectFactory,
    isTodlProject,
    CLAUDE_MD_FILENAME,
    CLAUDE_DIR,
    TODL_BASE_SCAFFOLD,
    type ScaffoldFile,
} from './solution-services/project-services/core/todl-project-factory.js';
export { ArchitectureProjectFactory } from './solution-services/project-services/architecture-project/architecture-project-factory.js';
export { MetaModelProjectFactory } from './solution-services/project-services/meta-model-project/meta-model-project-factory.js';
export { LibraryProjectFactory } from './solution-services/project-services/library-project/library-project-factory.js';
export { DefaultProjectFactoryRegistry } from './solution-services/project-services/default-project-factory-registry.js';
export {
    isBaseProducing,
    type IBaseProducingProjectFactory,
} from './solution-services/project-services/core/producer-project-factory.js';
export { ProducerProjectFactory, type ProducerManifest } from './solution-services/project-services/core/producer-project-factory-base.js';
// Producer seams (concrete impls live app-side; todl owns the contracts + keys).
export {
    PresentationBakerKey,
    type IPresentationBaker,
    type BakeOptions,
    type BakeResult,
} from './solution-services/project-services/core/presentation-baker.js';
export {
    PackageStoreKey,
    StoragePackageStore,
    type IPackageStore,
} from './solution-services/todl-build-system/package-store.js';
export type { IPackageSource, SourcedPackage } from './solution-services/todl-build-system/package-source.js';
export { CompositePackageSource } from './solution-services/todl-build-system/composite-package-source.js';
export { CachingPackageSource } from './solution-services/todl-build-system/caching-package-source.js';
export { SolutionCacheSource, type IWritablePackageSource } from './solution-services/todl-build-system/solution-cache-source.js';
export { RecursiveProjectReferencesResolver } from './solution-services/project-services/core/base-resolver.js';
// Producer helpers (headless): source collection, package sink, presentation emitter, bundle scan.
export { TodlProjectSourceFiles } from './solution-services/project-services/core/todl-sources.js';
export { StoragePackageSink } from './solution-services/project-services/core/storage-package-sink.js';
export {
    PresentationResourceEmitter,
    OntologyKind,
    type PresentationFacets,
} from './solution-services/project-services/core/presentation-model.js';
export {
    ProducerResources,
    type PackageBundle,
    type ScannedResources,
    type PublishedClass,
} from './solution-services/project-services/core/package-bundle.js';
