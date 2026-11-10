import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime';
import { check } from '../../../../compiler-services/api.js';
import { toJSON, type TodlDocument } from '../../../../compiler-services/emit/json.js';
import { Builder } from '../../../../compiler-services/model/builder.js';
import { DiagnosticCode } from '../../../../compiler-services/diagnostics/diagnostic.js';
import type { SourceFile } from '../../../../compiler-services/diagnostics/span.js';
import { SolutionGraph } from '../solution-graph.js';

/**
 * An app file over a published base that declares `datasource crm`. Editing the app file must never strip the base's
 * connector: an identical redeclaration is not a node the app file created (provenance keeps meaning "this file
 * created this node").
 */
class RedeclaredConnectorFx
{
    public static readonly Library = 'namespace crm { concept Customer { name : string?; } datasource crm { kind = sql; connection = "crm-db"; } }';
    public static readonly AppUri = 'app/app.todl';
    public static readonly AppId = 'app';
    public static readonly AppRedeclared = 'namespace crm { datasource crm { kind = sql; connection = "crm-db"; } model App : crm { connect crm; populate Customer key cust_id { name = "full_name"; } } }';
    public static readonly AppOtherDb = 'namespace crm { datasource crm { kind = sql; connection = "other-db"; } model App : crm { connect crm; populate Customer key cust_id { name = "full_name"; } } }';
    public static readonly AppWithout = 'namespace crm { model App : crm { connect crm; populate Customer key cust_id { name = "full_name"; } } }';
    public static readonly ConnectorId = 'crm@connector:crm';
    public static readonly Connection = 'crm-db';

    public static Base(): TodlDocument
    {
        const { model, diagnostics } = check([{ uri: 'lib.todl', text: RedeclaredConnectorFx.Library }]);
        assert.deepEqual(diagnostics, []);
        return toJSON(model);
    }

    public static File(text: string): SourceFile
    {
        return { uri: RedeclaredConnectorFx.AppUri, text };
    }

    public static async Open(): Promise<SolutionGraph>
    {
        const graph = new SolutionGraph();
        await graph.Build([{
            id: RedeclaredConnectorFx.AppId, storage: new FakeStorage(), sources: [RedeclaredConnectorFx.File(RedeclaredConnectorFx.AppRedeclared)],
            baseIds: [], publishedBases: [RedeclaredConnectorFx.Base()],
        }]);
        return graph;
    }

    public static Codes(graph: SolutionGraph): DiagnosticCode[]
    {
        return [...graph.DiagnosticsByUri().values()].flat().map((d) => d.code);
    }

    public static AssertBaseConnector(graph: SolutionGraph): void
    {
        assert.equal(graph.Model.resolve(RedeclaredConnectorFx.ConnectorId)?.attrs.get(Builder.ConnectorConnectionAttr), RedeclaredConnectorFx.Connection);
        assert.equal(graph.Provenance.get(RedeclaredConnectorFx.ConnectorId), undefined, 'the base connector is not homed in the app file');
    }
}

test('re-saving an identical redeclaration keeps the base connector, attributed to the base', async () =>
{
    const graph = await RedeclaredConnectorFx.Open();
    RedeclaredConnectorFx.AssertBaseConnector(graph);
    graph.ReplaceFile(RedeclaredConnectorFx.AppUri, [RedeclaredConnectorFx.File(RedeclaredConnectorFx.AppRedeclared)]);
    RedeclaredConnectorFx.AssertBaseConnector(graph);
    assert.deepEqual(RedeclaredConnectorFx.Codes(graph), []);
});

test('changing a redeclared connection is diagnosed as a conflicting declaration', async () =>
{
    const graph = await RedeclaredConnectorFx.Open();
    graph.ReplaceFile(RedeclaredConnectorFx.AppUri, [RedeclaredConnectorFx.File(RedeclaredConnectorFx.AppOtherDb)]);
    assert.ok(RedeclaredConnectorFx.Codes(graph).includes(DiagnosticCode.ConnectorConflictingDeclaration), JSON.stringify(RedeclaredConnectorFx.Codes(graph)));
    RedeclaredConnectorFx.AssertBaseConnector(graph);
});

test('removing the redeclaration leaves the base connector and no unknown-connector diagnostic', async () =>
{
    const graph = await RedeclaredConnectorFx.Open();
    graph.ReplaceFile(RedeclaredConnectorFx.AppUri, [RedeclaredConnectorFx.File(RedeclaredConnectorFx.AppWithout)]);
    RedeclaredConnectorFx.AssertBaseConnector(graph);
    assert.deepEqual(RedeclaredConnectorFx.Codes(graph), []);
});
