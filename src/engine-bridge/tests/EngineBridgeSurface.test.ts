import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as EngineSurface from '@pragmatic-tech-ai/todl/engine';
import type {
    IComposeInput,
    IDescribeDiagnostic,
    IDescribeOptions,
    IEnvironmentCatalog,
    IPackageDelivery,
    IPackageDocumentSource,
    IPrincipalFacts,
    ISavedModel,
    ISavedSnapshot,
    IShareSubjects,
    ISnapshotDescription,
    ITodlDraftSession,
    ITodlModelWorkspace,
    IUnifiedPackages,
} from '@pragmatic-tech-ai/todl/engine';
import * as Root from '@pragmatic-tech-ai/todl';

/** The type names the engine subpath exports; a missing one fails typecheck. */
interface IExportedTypes
{
    readonly Diagnostic: IDescribeDiagnostic;
    readonly Options: IDescribeOptions;
    readonly Description: ISnapshotDescription;
    readonly Facts: IPrincipalFacts;
    readonly Workspace: ITodlModelWorkspace;
    readonly Session: ITodlDraftSession;
    readonly SavedModel: ISavedModel;
    readonly SavedSnapshot: ISavedSnapshot;
    readonly ShareSubjects: IShareSubjects;
    readonly DocumentSource: IPackageDocumentSource;
    readonly ComposeInput: IComposeInput;
    readonly Catalog: IEnvironmentCatalog;
    readonly Delivery: IPackageDelivery;
    readonly Unified: IUnifiedPackages;
}

/** The runtime names `@pragmatic-tech-ai/todl/engine` exports: the one list every export change edits. */
class SurfaceExpectations
{
    public static readonly EngineExports: readonly string[] = [
        'CellConverter',
        'ChangeBatcher',
        'DataSourceConnector',
        'DataSourceTransaction',
        // The environment catalog composer (rulings T2, T3, T4, T11, T12).
        'DeliveryChannel',
        'EnvironmentCatalogComposer',
        'EnvironmentCatalogError',
        'EnvironmentCatalogErrorCode',
        'EnvironmentSecurity',
        'PackageVersionUnifier',
        'UnifiedPackageSource',
        'DescribeDiagnosticCode',
        'EngineBridgeError',
        'EngineBridgeErrorCode',
        'EngineCellMapper',
        'EnvironmentNodePlacement',
        'ExternalIdentity',
        'ExternalValues',
        'ExternalWriteError',
        'FetchTranslator',
        'ResumeToken',
        'SavedModelCompiler',
        // The todl.system package (ruling T10): its source, names and share-grant predicates.
        'ShareGrantScope',
        'ShareGrants',
        'ShareRight',
        'ShareSubject',
        'SnapshotDescriber',
        'SystemFieldGuard',
        'SystemFirstPackageSource',
        'SystemNames',
        'SystemPackage',
        'TodlFileConnector',
        // Reserved schema names a host needs: FileConnector for IDescribeOptions.DefaultConnector, Label / Class /
        // Term / Element for Cypher over the described schema.
        'TodlNames',
        'TodlNodePlacement',
    ];

    public static readonly RootCypherWire = 'CypherWire';
    public static readonly NoHomeModel = 'NoHomeModel';
    public static readonly UnknownConnector = 'UnknownConnector';
    public static readonly RootLeak = 'root must not export ';
}

describe('EngineBridgeSurface', () =>
{
    test('engine subpath exports exactly the bridge surface', () =>
    {
        assert.deepEqual(Object.keys(EngineSurface).sort(), [...SurfaceExpectations.EngineExports].sort());
        // The type exports are pinned by IExportedTypes above: typecheck fails when one is dropped.
        assert.ok(SurfaceExpectations.NoHomeModel in EngineSurface.EngineBridgeErrorCode);
        assert.ok(SurfaceExpectations.UnknownConnector in EngineSurface.EnvironmentCatalogErrorCode);
    });

    test('root entry exports CypherWire and none of the engine surface', () =>
    {
        const root = Root as unknown as Record<string, unknown>;
        assert.ok(root[SurfaceExpectations.RootCypherWire] !== undefined);
        for (const name of SurfaceExpectations.EngineExports)
        {
            assert.equal(root[name], undefined, SurfaceExpectations.RootLeak + name);
        }
    });
});
