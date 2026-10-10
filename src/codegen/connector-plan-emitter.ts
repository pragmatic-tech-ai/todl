// Builds a ModelConnectorPlan from the connector/population meta-nodes of a compiled
// Repository and emits it as a deterministic TypeScript literal. The emitted OUTPUT
// follows the read-client generated-code style, not house style.

import type { Repository } from "../compiler-services/model/model.js";
import type { NodeId } from "../compiler-services/model/graph.js";
import { MetaKind } from "../compiler-services/model/kinds.js";
import { Builder } from "../compiler-services/model/builder.js";
import {
    ConnectorPlanProjection,
    DataSourceKind,
    type ConnectorBinding,
    type ConnectorSpec,
    type ModelConnectorPlan,
} from "../model-data/connector-plan.js";

export class ConnectorPlanEmitter
{
    private static readonly DefaultVersion = "0.0.0";
    private static readonly KindTypeName = "DataSourceKind";
    private static readonly PlanTypeName = "ModelConnectorPlan";
    private static readonly PlanSuffix = "_PLAN";
    private static readonly ModelNameSeparator = ".";
    private static readonly Indent1 = "  ";
    private static readonly Indent2 = "    ";
    private static readonly Indent3 = "      ";
    private static readonly EmptyObject = "{}";

    private static readonly KindMembers: ReadonlyMap<string, DataSourceKind> = new Map<string, DataSourceKind>([
        [DataSourceKind.Sql, DataSourceKind.Sql],
        [DataSourceKind.Rest, DataSourceKind.Rest],
        [DataSourceKind.Cypher, DataSourceKind.Cypher],
        [DataSourceKind.Document, DataSourceKind.Document],
    ]);

    private static readonly KindMemberNames: ReadonlyMap<DataSourceKind, string> = new Map<DataSourceKind, string>([
        [DataSourceKind.Sql, "Sql"],
        [DataSourceKind.Rest, "Rest"],
        [DataSourceKind.Cypher, "Cypher"],
        [DataSourceKind.Document, "Document"],
    ]);

    /** Name of the emitted plan constant for a shard slug. */
    public static ConstantName(shardSlug: string): string
    {
        return shardSlug + ConnectorPlanEmitter.PlanSuffix;
    }

    public static PlanFor(repo: Repository, modelId: NodeId): ModelConnectorPlan | undefined
    {
        const populations = repo
            .nodesOfMetaKind(MetaKind.Population)
            .map((id) => repo.resolve(id))
            .filter((node) => node !== undefined && node.attrs.get(Builder.BindingModelAttr) === modelId);
        if (populations.length === 0)
        {
            return undefined;
        }

        const specs = new Map<string, ConnectorSpec>();
        const bindings: ConnectorBinding[] = [];
        for (const population of populations)
        {
            const attrs = population!.attrs;
            const connectorNode = repo.resolve(String(attrs.get(Builder.BindingConnectorAttr)) as NodeId);
            const spec = connectorNode === undefined
                ? undefined
                : ConnectorPlanEmitter.SpecOf(connectorNode.attrs);
            if (spec === undefined)
            {
                continue;
            }
            specs.set(spec.Name, spec);
            bindings.push({
                Concept: String(attrs.get(Builder.BindingConceptAttr)),
                Connector: spec.Name,
                Source: String(attrs.get(Builder.BindingSourceAttr)),
                IdKey: String(attrs.get(Builder.BindingIdKeyAttr)),
                FieldMap: JSON.parse(String(attrs.get(Builder.BindingFieldMapAttr))) as Record<string, string>,
                Writable: attrs.get(Builder.BindingWritableAttr) === true,
            });
        }
        if (bindings.length === 0)
        {
            return undefined;
        }
        return {
            Model: ConnectorPlanEmitter.LocalName(modelId),
            Version: ConnectorPlanEmitter.DefaultVersion,
            Connectors: [...specs.values()],
            Bindings: bindings,
        };
    }

    public static Emit(plan: ModelConnectorPlan, constantName: string): string
    {
        const p = ConnectorPlanProjection.Normalize(plan);
        const i1 = ConnectorPlanEmitter.Indent1;
        const connectors = p.Connectors.map((c) => ConnectorPlanEmitter.EmitConnector(c)).join("\n");
        const bindings = p.Bindings.map((b) => ConnectorPlanEmitter.EmitBinding(b)).join("\n");
        return (
            `const ${constantName}: ${ConnectorPlanEmitter.PlanTypeName} = {\n` +
            `${i1}Model: ${JSON.stringify(p.Model)},\n` +
            `${i1}Version: ${JSON.stringify(p.Version)},\n` +
            `${i1}Connectors: [\n${connectors}\n${i1}],\n` +
            `${i1}Bindings: [\n${bindings}\n${i1}],\n` +
            `};`
        );
    }

    private static SpecOf(attrs: ReadonlyMap<string, unknown>): ConnectorSpec | undefined
    {
        const kind = ConnectorPlanEmitter.KindMembers.get(String(attrs.get(Builder.ConnectorKindAttr)));
        if (kind === undefined)
        {
            return undefined;
        }
        const configJson = attrs.get(Builder.ConnectorConfigAttr);
        const spec: ConnectorSpec = {
            Name: String(attrs.get(Builder.ConnectorNameAttr)),
            Kind: kind,
            Config: configJson === undefined
                ? {}
                : JSON.parse(String(configJson)) as Record<string, string>,
        };
        const connection = attrs.get(Builder.ConnectorConnectionAttr);
        if (connection !== undefined)
        {
            spec.Connection = String(connection);
        }
        const secret = attrs.get(Builder.ConnectorSecretAttr);
        if (secret !== undefined)
        {
            spec.Secret = String(secret);
        }
        return spec;
    }

    private static LocalName(modelId: NodeId): string
    {
        const id = String(modelId);
        return id.slice(id.lastIndexOf(ConnectorPlanEmitter.ModelNameSeparator) + 1);
    }

    private static EmitConnector(c: ConnectorSpec): string
    {
        const i3 = ConnectorPlanEmitter.Indent3;
        const lines = [
            `${i3}Name: ${JSON.stringify(c.Name)},`,
            `${i3}Kind: ${ConnectorPlanEmitter.KindTypeName}.${ConnectorPlanEmitter.KindMemberNames.get(c.Kind)},`,
        ];
        if (c.Connection !== undefined)
        {
            lines.push(`${i3}Connection: ${JSON.stringify(c.Connection)},`);
        }
        lines.push(`${i3}Config: ${ConnectorPlanEmitter.EmitRecord(c.Config)},`);
        if (c.Secret !== undefined)
        {
            lines.push(`${i3}Secret: ${JSON.stringify(c.Secret)},`);
        }
        return ConnectorPlanEmitter.Wrap(lines);
    }

    private static EmitBinding(b: ConnectorBinding): string
    {
        const i3 = ConnectorPlanEmitter.Indent3;
        return ConnectorPlanEmitter.Wrap([
            `${i3}Concept: ${JSON.stringify(b.Concept)},`,
            `${i3}Connector: ${JSON.stringify(b.Connector)},`,
            `${i3}Source: ${JSON.stringify(b.Source)},`,
            `${i3}IdKey: ${JSON.stringify(b.IdKey)},`,
            `${i3}FieldMap: ${ConnectorPlanEmitter.EmitRecord(b.FieldMap)},`,
            `${i3}Writable: ${b.Writable},`,
        ]);
    }

    private static Wrap(lines: readonly string[]): string
    {
        return `${ConnectorPlanEmitter.Indent2}{\n${lines.join("\n")}\n${ConnectorPlanEmitter.Indent2}},`;
    }

    private static EmitRecord(record: Readonly<Record<string, string>>): string
    {
        const keys = Object.keys(record);
        if (keys.length === 0)
        {
            return ConnectorPlanEmitter.EmptyObject;
        }
        const entries = keys.map((k) => `${JSON.stringify(k)}: ${JSON.stringify(record[k])}`);
        return `{ ${entries.join(", ")} }`;
    }
}
