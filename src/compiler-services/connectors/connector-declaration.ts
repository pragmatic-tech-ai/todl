import { Builder } from "../model/builder.js";
import { MetaKind } from "../model/kinds.js";
import type { TodlDocument } from "../emit/json.js";
import { DiagnosticCode, Severity, type Diagnostic } from "../diagnostics/diagnostic.js";
import { MessageTemplate } from "../diagnostics/message-template.js";

/**
 * Compares `datasource` declarations. A connector node id is namespace-scoped (`<ns>@connector:<name>`), so two
 * packages, or two bases of one compile, can declare the same id. Identical declarations are one connector; differing
 * ones must be reported rather than resolved first-wins (ConnectorConflictingDeclaration).
 */
export class ConnectorDeclaration
{
    private static readonly ScalarAttrs: readonly string[] = [
        Builder.ConnectorNameAttr, Builder.ConnectorKindAttr, Builder.ConnectorConnectionAttr, Builder.ConnectorSecretAttr, Builder.ConnectorProviderAttr,
    ];
    private static readonly BasesMessage = "datasource \"{0}\" is declared differently by two of the packages compiled against; the first is used";
    private static readonly RedeclaredMessage = "datasource \"{0}\" redeclares \"{1}\" differently from an existing declaration; the existing one is used";

    /** True when two connector nodes' attrs declare one connector: equal name, kind, connection, secret, provider and config (key order ignored). */
    public static Same(a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>): boolean
    {
        if (!ConnectorDeclaration.ScalarAttrs.every((key) => a[key] === b[key])) return false;
        return ConnectorDeclaration.SameConfig(a[Builder.ConnectorConfigAttr], b[Builder.ConnectorConfigAttr]);
    }

    /** The ConnectorConflictingDeclaration message for a source declaration `name` that differs from the existing `connectorId`. */
    public static Redeclared(name: string, connectorId: string): string
    {
        return MessageTemplate.Format(ConnectorDeclaration.RedeclaredMessage, name, connectorId);
    }

    /**
     * True when `node` is a connector the compiled sources declare themselves, even though a base already holds an
     * identical one (ruling P16): the loader reports such a redeclaration in `redeclared` (never in provenance), and
     * it belongs to the package's own-only document so that compose compares it against the dependency's (possibly
     * newer) declaration.
     */
    public static IsOwnRedeclaration(node: { readonly id: string; readonly metaKind: MetaKind | null }, redeclared: ReadonlySet<string>): boolean
    {
        return node.metaKind === MetaKind.Connector && redeclared.has(node.id);
    }

    /** One ConnectorConflictingDeclaration per connector id that two bases declare differently (the first base is kept). */
    public static BaseConflicts(bases: readonly TodlDocument[]): Diagnostic[]
    {
        const first = new Map<string, Readonly<Record<string, unknown>>>();
        const reported = new Set<string>();
        const out: Diagnostic[] = [];
        for (const base of bases)
        {
            for (const node of base.nodes)
            {
                if (node.metaKind !== MetaKind.Connector) continue;
                const existing = first.get(node.id);
                if (existing === undefined)
                {
                    first.set(node.id, node.attrs);
                }
                else if (!reported.has(node.id) && !ConnectorDeclaration.Same(existing, node.attrs))
                {
                    reported.add(node.id);
                    out.push({
                        code: DiagnosticCode.ConnectorConflictingDeclaration, severity: Severity.Error,
                        message: MessageTemplate.Format(ConnectorDeclaration.BasesMessage, node.id),
                        span: null, node: node.id, path: null,
                    });
                }
            }
        }
        return out;
    }

    private static SameConfig(a: unknown, b: unknown): boolean
    {
        if (a === b) return true;
        const left = ConnectorDeclaration.ParseConfig(a);
        const right = ConnectorDeclaration.ParseConfig(b);
        if (left === undefined || right === undefined) return false;
        const keys = Object.keys(left).sort();
        const other = Object.keys(right).sort();
        return keys.length === other.length && keys.every((key, i) => key === other[i] && left[key] === right[key]);
    }

    private static ParseConfig(value: unknown): Record<string, unknown> | undefined
    {
        if (typeof value !== "string") return undefined;
        try
        {
            const parsed: unknown = JSON.parse(value);
            return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
        }
        catch
        {
            return undefined;
        }
    }
}
