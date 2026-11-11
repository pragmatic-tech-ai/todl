import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as EngineSurface from '@pragmatic-tech-ai/todl/engine';
import * as Root from '@pragmatic-tech-ai/todl';

class SurfaceExpectations
{
    public static readonly EngineExports: readonly string[] = [
        'DataSourceConnector',
        'ExternalIdentity',
        'ExternalWriteError',
        'EnvironmentCatalogComposer',
        'EnvironmentCatalogError',
        'EnvironmentCatalogErrorCode',
        'DeliveryChannel',
        'EnvironmentNodePlacement',
        'SystemPackage',
        'SystemNames',
        'ShareGrantScope',
        'ShareGrants',
        'ShareRight',
        'ShareSubject',
        'PolicyScopeCompiler',
        'EngineBridgeErrorCode',
    ];

    public static readonly RootCypherWire = 'CypherWire';
    public static readonly NoHomeModel = 'NoHomeModel';
    public static readonly UnknownConnector = 'UnknownConnector';
    public static readonly FromRules = 'FromRules';
}

describe('EngineBridgeSurface', () =>
{
    test('engine subpath exports the runtime surface', () =>
    {
        const surface = EngineSurface as unknown as Record<string, unknown>;
        for (const name of SurfaceExpectations.EngineExports)
        {
            assert.ok(surface[name] !== undefined, `missing engine export ${name}`);
        }
        assert.equal(typeof EngineSurface.PolicyScopeCompiler.FromRules, 'function', SurfaceExpectations.FromRules);
        assert.ok(SurfaceExpectations.NoHomeModel in EngineSurface.EngineBridgeErrorCode);
        assert.ok(SurfaceExpectations.UnknownConnector in EngineSurface.EnvironmentCatalogErrorCode);
    });

    test('root entry exports CypherWire and none of the engine surface', () =>
    {
        const root = Root as unknown as Record<string, unknown>;
        assert.ok(root[SurfaceExpectations.RootCypherWire] !== undefined);
        for (const name of SurfaceExpectations.EngineExports)
        {
            assert.equal(root[name], undefined, `root must not export ${name}`);
        }
    });
});
