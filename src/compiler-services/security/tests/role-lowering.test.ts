import { test } from "node:test";
import assert from "node:assert/strict";

import { check, checkAgainst } from "../../api.js";
import { Builder } from "../../model/builder.js";
import { MetaKind } from "../../model/kinds.js";
import { DiagnosticCode, Severity, type Diagnostic } from "../../diagnostics/diagnostic.js";
import type { SourceFile, SourceSpan } from "../../diagnostics/span.js";
import type { Repository } from "../../model/model.js";
import { toJSON, type TodlDocument } from "../../emit/json.js";

/** The role-lowering fixture: a compiled `crm` dependency plus the own `projects` sources. */
class RoleFx
{
    public static readonly ProjectsUri = "projects.todl";
    public static readonly RolesUri = "roles.todl";
    public static readonly Projects = `namespace projects
{
    concept Project : todl.system.Owned { name : string; }
    concept Setting { key : string; }
    concept Link { from : Project; to : Project; }
    operator --> : Link (from, to);
}`;
    private static base: TodlDocument | undefined;

    /** The compiled `crm` dependency (`concept Account`). */
    public static Base(): TodlDocument
    {
        RoleFx.base ??= toJSON(check([{ uri: "crm.todl", text: "namespace crm { concept Account { name : string; } }" }]).model);
        return RoleFx.base;
    }

    /** Compile `body` inside `namespace projects { import crm; … }` against the base, plus `extra` sources. */
    public static Check(body: string, extra: readonly SourceFile[] = [], bases: readonly TodlDocument[] = [RoleFx.Base()]): { model: Repository; diagnostics: Diagnostic[]; texts: Map<string, string> }
    {
        const sources: SourceFile[] = [
            { uri: RoleFx.ProjectsUri, text: RoleFx.Projects },
            { uri: RoleFx.RolesUri, text: `namespace projects\n{\n    import crm;\n    ${body}\n}` },
            ...extra,
        ];
        const { model, diagnostics } = checkAgainst([...bases], sources);
        return { model, diagnostics, texts: new Map(sources.map((s) => [s.uri, s.text])) };
    }

    public static Errors(diagnostics: readonly Diagnostic[]): Diagnostic[]
    {
        return diagnostics.filter((d) => d.severity === Severity.Error);
    }

    /** The source text a single-line span covers. */
    public static Word(texts: ReadonlyMap<string, string>, span: SourceSpan | null): string
    {
        assert.ok(span !== null, "diagnostic has a span");
        const line = texts.get(span.uri)!.split("\n")[span.start.line - 1]!;
        return line.slice(span.start.column - 1, span.end.column - 1);
    }

    /** Assert exactly one error, with `code`, whose span covers `word`. */
    public static Rejects(body: string, code: DiagnosticCode, word: string, extra: readonly SourceFile[] = [], bases?: readonly TodlDocument[]): void
    {
        const { diagnostics, texts } = RoleFx.Check(body, extra, bases);
        const matching = diagnostics.filter((d) => d.code === code);
        assert.equal(matching.length, 1, `${code}: ${JSON.stringify(diagnostics)}`);
        assert.equal(matching[0]!.severity, Severity.Error);
        assert.equal(RoleFx.Word(texts, matching[0]!.span), word);
    }
}

test("a role lowers to one role node with qualified privileges", () =>
{
    const { model, diagnostics } = RoleFx.Check(`role ProjectManager { Project { read = businessUnitAndChildren; update = businessUnit; } }`);
    assert.deepEqual(RoleFx.Errors(diagnostics), []);
    const node = model.resolve("projects.ProjectManager@role")!;
    assert.equal(node.metaKind, MetaKind.Role);
    assert.deepEqual(JSON.parse(String(node.attrs.get(Builder.RolePrivilegesAttr))), [
        { Concept: "projects.Project", Action: "read", Depth: "businessUnitAndChildren" },
        { Concept: "projects.Project", Action: "update", Depth: "businessUnit" }]);
});

test("two contribute BasicUser blocks merge into one node", () =>
{
    const { model, diagnostics } = RoleFx.Check(
        `contribute BasicUser { Project { read = user; } } contribute BasicUser { Setting { read = organization; } }`);
    assert.deepEqual(RoleFx.Errors(diagnostics), []);
    const node = model.resolve("projects.BasicUser@contribution")!;
    assert.equal(node.metaKind, MetaKind.RoleContribution);
    assert.equal(node.attrs.get(Builder.ContributionRoleAttr), "BasicUser");
    assert.deepEqual(JSON.parse(String(node.attrs.get(Builder.RolePrivilegesAttr))), [
        { Concept: "projects.Project", Action: "read", Depth: "user" },
        { Concept: "projects.Setting", Action: "read", Depth: "organization" }]);
});

test("privilege on a dependency's concept is security.foreign-concept", () =>
{
    RoleFx.Rejects(`role R { Account { read = organization; } }`, DiagnosticCode.SecurityForeignConcept, "Account");
});

test("privilege on todl.system.ShareGrant is security.foreign-concept", () =>
{
    RoleFx.Rejects(`role R { todl.system.ShareGrant { read = organization; } }`, DiagnosticCode.SecurityForeignConcept, "todl.system.ShareGrant");
});

test("contribute basicuser is security.unknown-base-role", () =>
{
    RoleFx.Rejects(`contribute basicuser { Project { read = user; } }`, DiagnosticCode.SecurityUnknownBaseRole, "basicuser");
});

test("contribute SystemAdministrator is rejected", () =>
{
    RoleFx.Rejects(`contribute SystemAdministrator { Project { read = user; } }`, DiagnosticCode.SecuritySystemAdministratorContribution, "SystemAdministrator");
});

test("role BasicUser is security.role-shadows-base-role", () =>
{
    RoleFx.Rejects(`role BasicUser { Project { read = user; } }`, DiagnosticCode.SecurityRoleShadowsBaseRole, "BasicUser");
});

test("unknown action 'write' is security.unknown-action", () =>
{
    RoleFx.Rejects(`role R { Project { write = user; } }`, DiagnosticCode.SecurityUnknownAction, "write");
});

test("unknown depth 'team' is security.unknown-depth", () =>
{
    RoleFx.Rejects(`role R { Project { read = team; } }`, DiagnosticCode.SecurityUnknownDepth, "team");
});

test("user depth on unowned Setting is security.depth-requires-ownership", () =>
{
    RoleFx.Rejects(`role R { Setting { read = user; } }`, DiagnosticCode.SecurityDepthRequiresOwnership, "user");
});

test("organization depth on unowned Setting is accepted", () =>
{
    const { model, diagnostics } = RoleFx.Check(`role R { Setting { read = organization; } }`);
    assert.deepEqual(RoleFx.Errors(diagnostics), []);
    assert.ok(model.resolve("projects.R@role") !== undefined);
});

test("privilege on reified edge concept Link is security.edge-concept-privilege", () =>
{
    RoleFx.Rejects(`role R { Link { read = organization; } }`, DiagnosticCode.SecurityEdgeConceptPrivilege, "Link");
});

test("two operators binding Link to different members is security.edge-endpoints-conflict", () =>
{
    RoleFx.Rejects(``, DiagnosticCode.SecurityEdgeEndpointsConflict, "<--",
        [{ uri: "reverse.todl", text: "namespace projects { operator <-- : Link (to, from); }" }]);
    // A base's operator fixes the pair: the own operator is reported even though its glyph sorts first.
    const linked = toJSON(check([{ uri: "crm.todl", text: "namespace crm { concept Account { name : string; } concept Tie { a : Account; b : Account; } operator ~~> : Tie (b, a); }" }]).model);
    RoleFx.Rejects(``, DiagnosticCode.SecurityEdgeEndpointsConflict, "<~~",
        [{ uri: "tie.todl", text: "namespace projects { import crm; operator <~~ : Tie (a, b); }" }], [linked]);
});

test("one action twice on one concept is security.duplicate-privilege", () =>
{
    RoleFx.Rejects(`role R { Project { read = user; read = organization; } }`, DiagnosticCode.SecurityDuplicatePrivilege, "read");
    // The same base-role privilege from two namespaces of one package is reported on the contribution later in node order.
    RoleFx.Rejects(`contribute BasicUser { Project { read = user; } }`, DiagnosticCode.SecurityDuplicatePrivilege, "read",
        [{ uri: "other.todl", text: "namespace other { import projects; contribute BasicUser { Project { read = organization; } } }" }]);
});

test("one role name in two namespaces is security.duplicate-role", () =>
{
    RoleFx.Rejects(`role Lead { Project { read = organization; } }`, DiagnosticCode.SecurityDuplicateRole, "Lead",
        [{ uri: "other.todl", text: "namespace other { role Lead { } }" }]);
});
