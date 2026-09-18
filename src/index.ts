/** Public API for `@pragmatic-tech-ai/todl`. */

export { Signal, type Disposable } from "@pragmatic-tech-ai/todl-runtime";
export {
  Ask, ConfirmAsk, PickFolderAsk, PickFileAsk, PromptTextAsk, ChooseAsk,
  type FileFilter, type Choice, type IPromptService,
} from "@pragmatic-tech-ai/todl-runtime";

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
} from "./model/graph.js";

export { InMemoryGraphStore, type GraphStore } from "./model/graph-store.js";

export {
  CypherGraphStore,
  type CypherSession,
  type CypherOp,
  type CypherRow,
} from "./model/cypher-store.js";

export {
  ReactiveNode,
  PropertyChangeKind,
  CollectionChangeKind,
  type PropertyChangedArgs,
  type CollectionChangedArgs,
  type INotifyPropertyChanged,
  type INotifyCollectionChanged,
} from "./model/reactive.js";

export { Builder, type TermInput } from "./model/builder.js";
export { MetaKind } from "./model/kinds.js";

export {
  Repository,
  type FieldSchema,
  type RelationshipSchema,
  type ConceptSchema,
} from "./model/model.js";

export { EntityBase, type Entity } from "./model/entity.js";

export {
  toElement,
  type Element,
  type ElementSchema,
  type Provenance,
  type IncomingRef,
  type PresentationHint,
  type ToElementOptions,
} from "./model/element.js";

export { FrozenRepository } from "./model/frozen.js";

export { generateReadClient, isReferenceType, type ReadClientOptions } from "./codegen/read-client.js";

export { ModelDraft, type InstanceDescriptor } from "./authoring/model-draft.js";

export { TodlFileStore, type FileIO } from "./authoring/file-store.js";
export { deriveBindings, emitModelTodl, type ModelBindings } from "./emit/todl.js";

export {
  compilePackage,
  publish,
  PackageKind,
  type PackageRef,
  type PackageIdentity,
  type PackageDocument,
  type CompiledPackage,
  type CompileOutcome,
  type PublishOutcome,
} from "./publish/publish.js";
export {
  BlobPackageStore,
  GraphPackageStore,
  type PackageStore,
  type PackageSink,
} from "./publish/stores.js";
export { deriveClasses, projectAnnotations, type PublishedClass } from "./publish/reflect.js";
export { StoragePackageSource } from "./package-manager/storage-package-source.js";

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
} from "./predicate/ast.js";

export { evaluate, satisfies, type EvalValue } from "./predicate/evaluate.js";

export { validate } from "./validate/validate.js";
export { Severity, DiagnosticCode, type Diagnostic } from "./diagnostics/diagnostic.js";
export type { Position, SourceSpan, SourceFile } from "./diagnostics/span.js";
export { check, checkAgainst } from "./api.js";

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
} from "./emit/json.js";

export { toMetaModule, type MetaModuleOptions } from "./emit/js-module.js";

export { rewrite } from "./migrate/rewriter.js";

export { load, type LoadResult } from "./parse/loader.js";
export { parse, type ParseResult } from "./parse/parser.js";
export { parsePredicate } from "./parse/predicate-parser.js";
export { tokenize, TokenKind, type Token } from "./parse/lexer.js";

// ── Solution (SolutionManager + cross-project settings) ──
// The engine composition module is authored in .mu (a plain `module` → a headless
// Module) and compiled to .mu.js by `npm run compile:mu`.
export { SolutionServicesEngine } from "./solution/solution-services-engine.mu.js";
export { SolutionManagerService } from "./solution/engine/solution-manager-service.js";
export {
  ProjectFactoryRegistryKey,
  type IStorageProviderRegistry,
  type IProjectFactoryRegistry,
} from "./solution/engine/host-services.js";
export { ProjectFactoryRegistry } from "./solution/engine/project-factory-registry.js";
export { type INotificationService } from "./solution/engine/notification-service.js";
export { SolutionSettingsRegistry } from "./solution/engine/solution-settings-registry.js";
export { SettingBagDefinition } from "./solution/engine/setting-bag-definition.js";
export { SolutionSettingBag } from "./solution/engine/solution-setting-bag.js";
export { Solution } from "./solution/engine/solution.js";
export { SolutionSession } from "./solution/engine/solution-session.js";
export { SolutionMember } from "./solution/engine/solution-member.js";
export { SolutionManifest } from "./solution/engine/solution-manifest.js";
export { type SolutionMemberRef, SolutionPath } from "./solution/engine/solution-member-ref.js";
export { SolutionTreeVM, SolutionNodeVM, SolutionMemberNodeVM, type MemberStorageFor } from "./solution/presentation/solution-tree-vm.js";
export { SettingBagGrid } from "./solution/presentation/setting-bag-grid.js";
export {
  type IProjectFactory,
  type MemberStorageResolver,
  type ProjectFactoryResolver,
} from "./solution/engine/project-factory.js";

// ── Projects (headless Project model + factory contracts + TODL-authoring base) ──
export { Project, ProjectNode, ProjectNodeKind } from "./solution/projects/project.js";
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
} from "./solution/projects/project-factory.js";
export { type BaseRef, type BaseBindings } from "./solution/projects/base-binding.js";
export {
  TodlProjectFactory,
  isTodlProject,
  CLAUDE_MD_FILENAME,
  CLAUDE_DIR,
  TODL_BASE_SCAFFOLD,
  type ScaffoldFile,
} from "./solution/projects/todl-project-factory.js";
export { ArchitectureProjectFactory } from "./solution/projects/architecture-project-factory.js";
export { MetaModelProjectFactory } from "./solution/projects/meta-model-project-factory.js";
export { LibraryProjectFactory } from "./solution/projects/library-project-factory.js";
export { isProducer, type IProducerProjectFactory } from "./solution/projects/producer-project-factory.js";
// Producer seams (concrete impls live app-side; todl owns the contracts + keys).
export {
  PresentationBakerKey,
  type IPresentationBaker,
  type BakeOptions,
  type BakeResult,
} from "./solution/projects/presentation-baker.js";
export { ProducerBackendsKey, type IProducerBackends } from "./solution/projects/producer-backends.js";
export { BaseResolver } from "./solution/projects/base-resolver.js";
// Producer helpers (headless): source collection, package sink, presentation emitter, bundle scan.
export { TodlSources } from "./solution/projects/todl-sources.js";
export { StoragePackageSink } from "./solution/projects/storage-package-sink.js";
export {
  PresentationModel,
  OntologyKind,
  type PresentationFacets,
} from "./solution/projects/presentation-model.js";
export {
  LibraryResources,
  type LibraryBundleManifest,
  type ScannedResources,
  type PublishedClass as LibraryPublishedClass,
} from "./solution/projects/library-bundle.js";
export { type MetaModelManifestFile } from "./solution/projects/meta-model-manifest.js";
