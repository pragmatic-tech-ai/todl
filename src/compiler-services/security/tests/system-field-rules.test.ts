import { test } from "node:test";
import assert from "node:assert/strict";

import { check } from "../../api.js";
import { DiagnosticCode, Severity, type Diagnostic } from "../../diagnostics/diagnostic.js";

/** The system-field fixture: `body` compiled inside `namespace n`, beside a plain concept `X` and an annotation `heat`. */
class SystemFieldFx
{
    public static readonly SecurityCodePrefix = "security.";
    public static readonly Prefix = "concept X { } annotation heat { level : number; }";

    public static Check(body: string): Diagnostic[]
    {
        return check([{ uri: "n.todl", text: `namespace n\n{\n    ${SystemFieldFx.Prefix}\n    ${body}\n}` }]).diagnostics;
    }

    public static Errors(diagnostics: readonly Diagnostic[]): Diagnostic[]
    {
        return diagnostics.filter((d) => d.severity === Severity.Error);
    }

    public static Security(diagnostics: readonly Diagnostic[]): Diagnostic[]
    {
        return diagnostics.filter((d) => d.code.startsWith(SystemFieldFx.SecurityCodePrefix));
    }
}

test("system-field rules reject packages that shape or write owner / owningBusinessUnit", () =>
{
    const cases: { body: string; code: DiagnosticCode; also?: DiagnosticCode }[] = [
        { body: "concept E : todl.system.Owned { owner : string?; }", code: DiagnosticCode.SecuritySystemFieldDeclared, also: DiagnosticCode.MemberRedeclared },
        { body: "concept P : todl.system.Owned { } concept C : P { owningBusinessUnit : integer?; }", code: DiagnosticCode.SecuritySystemFieldDeclared, also: DiagnosticCode.MemberRedeclared },
        { body: "aspect Mine { owner : string?; } concept E : todl.system.Owned, Mine { }", code: DiagnosticCode.SecuritySystemFieldDeclared, also: DiagnosticCode.MemberCollision },
        { body: "concept E : todl.system.Owned { derive owner = \"x\"; }", code: DiagnosticCode.SecuritySystemFieldDerived },
        { body: "concept E : todl.system.Owned { member owner { annotate heat { level = 3; } } }", code: DiagnosticCode.SecuritySystemFieldAnnotated },
        { body: "concept E : todl.system.Owned { name : string?; } model M : n { E e1 { owner = \"u1\"; } }", code: DiagnosticCode.SecuritySystemFieldWritten },
        { body: "concept L : todl.system.Owned { from : X; to : X; } operator ==> : L (from, to);", code: DiagnosticCode.SecurityOwnedEdgeConcept },
        { body: "concept E : todl.system.Owned { name : string?; } datasource crm { kind = sql; connection = \"c\"; } model M : n { connect crm; populate E; }", code: DiagnosticCode.SecurityExternalConcept },
        { body: "concept S { secured Salary : number?; } datasource crm { kind = sql; connection = \"c\"; } model M : n { connect crm; populate S; }", code: DiagnosticCode.SecurityExternalConcept },
    ];
    for (const { body, code, also } of cases)
    {
        const diagnostics = SystemFieldFx.Check(body);
        const security = SystemFieldFx.Security(diagnostics);
        assert.deepEqual(security.map((d) => d.code), [code], `${body}: ${JSON.stringify(diagnostics)}`);
        assert.equal(security[0]!.severity, Severity.Error, body);
        assert.ok(security[0]!.span, `${code} has a span: ${body}`);
        const others = SystemFieldFx.Errors(diagnostics).filter((d) => !d.code.startsWith(SystemFieldFx.SecurityCodePrefix)).map((d) => d.code);
        assert.deepEqual(others, also === undefined ? [] : [also], `${body}: ${JSON.stringify(diagnostics)}`);
    }
});

test("an unowned concept may declare its own field named owner", () =>
{
    const diagnostics = SystemFieldFx.Check("concept U { owner : string?; owningBusinessUnit : string?; } model M : n { U u1 { owner = \"me\"; } }");
    assert.deepEqual(SystemFieldFx.Errors(diagnostics), []);
});

test("a seed instance of an owned concept without system fields compiles clean", () =>
{
    const diagnostics = SystemFieldFx.Check("concept E : todl.system.Owned { name : string?; } model M : n { E e1 { name = \"a\"; } }");
    assert.deepEqual(SystemFieldFx.Errors(diagnostics), []);
});
