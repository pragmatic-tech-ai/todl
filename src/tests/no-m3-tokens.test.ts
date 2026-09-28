import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "@pragmatic-tech-ai/mural/resources/material";
import "@pragmatic-tech-ai/mural/resources/pragmatic";
import { ThemeManager } from "@pragmatic-tech-ai/mural/visual-engine";

// Scheme-membership guard. After the Pragmatic migration no .mu markup and no .ts
// theme-key resolver call may reference a Material token that Pragmatic does not
// also define, and nothing may import Mural's Material resource bundle.
//
// The forbidden set is DERIVED, not hand-listed: it is the Material theme's own
// vocabulary (its token catalog plus every scheme's token map) minus the Pragmatic
// vocabulary. So it stays exhaustive as Material evolves -- the tokens an earlier
// hand-maintained denylist missed (state layers, type-scale scalars, @DiagramCanvas)
// all live in Material's catalog -- and it never flags an app-local x:key, an icon
// geometry, or a cross-package resource key, because those are not Material tokens.
// The single token both themes define (@Scrim) is excluded by the Pragmatic subtraction.
class SchemeMembershipScan
{
    private static readonly MaterialThemeName = "Material";
    private static readonly PragmaticThemeName = "Pragmatic";
    private static readonly MaterialImport = "mural/resources/material";
    private static readonly TestFile = "no-m3-tokens.test.ts";

    // .ts theme-key resolver call sites where a bare token name is a live key.
    private static readonly TsKeyContexts: readonly string[] =
    [
        "themeColor", "bindTheme", "Resolve", "DynamicResource",
    ];

    // A theme's full token vocabulary: its declared catalog plus every scheme's
    // token map (colours live on the schemes, scalars/type/shape on the catalog).
    public static Vocabulary(themeName: string): Set<string>
    {
        const theme = ThemeManager.GetTheme(themeName) as unknown as
            {
                catalog: ReadonlyMap<string, unknown>;
                schemes: ReadonlyMap<string, { tokens: ReadonlyMap<string, unknown> }>;
            } | undefined;
        const out = new Set<string>();
        if (theme === undefined) return out;
        for (const k of theme.catalog.keys()) out.add(k);
        for (const s of theme.schemes.values()) for (const k of s.tokens.keys()) out.add(k);
        return out;
    }

    // Material tokens Pragmatic does not define -- what must not appear under Pragmatic.
    public static ForbiddenTokens(): Set<string>
    {
        const material = SchemeMembershipScan.Vocabulary(SchemeMembershipScan.MaterialThemeName);
        const pragmatic = SchemeMembershipScan.Vocabulary(SchemeMembershipScan.PragmaticThemeName);
        const out = new Set<string>();
        for (const t of material) if (!pragmatic.has(t)) out.add(t);
        return out;
    }

    // The @Name resource references on one .mu line.
    public static MuRefs(line: string): string[]
    {
        const out: string[] = [];
        const re = /@([A-Za-z][A-Za-z0-9]*)/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(line)) !== null)
        {
            const name = m[1];
            if (name !== undefined) out.push(name);
        }
        return out;
    }

    public static ScanMu(file: string, text: string, forbidden: ReadonlySet<string>): string[]
    {
        const hits: string[] = [];
        text.split("\n").forEach((line, i) =>
        {
            if (line.includes(SchemeMembershipScan.MaterialImport))
                hits.push(`${file}:${i + 1} imports ${SchemeMembershipScan.MaterialImport}`);
            for (const tok of SchemeMembershipScan.MuRefs(line))
                if (forbidden.has(tok))
                    hits.push(`${file}:${i + 1} @${tok} (Material token absent from Pragmatic)`);
        });
        return hits;
    }

    public static ScanTs(file: string, text: string, forbidden: ReadonlySet<string>): string[]
    {
        const hits: string[] = [];
        text.split("\n").forEach((line, i) =>
        {
            if (line.includes(SchemeMembershipScan.MaterialImport))
                hits.push(`${file}:${i + 1} imports ${SchemeMembershipScan.MaterialImport}`);
            if (!SchemeMembershipScan.TsKeyContexts.some(c => line.includes(c))) return;
            for (const tok of forbidden)
                if (new RegExp("['\"]" + tok + "['\"]").test(line))
                    hits.push(`${file}:${i + 1} '${tok}'`);
        });
        return hits;
    }

    // Locate this package's `src` root by walking up from this test file to the
    // nearest package.json (ESM-safe -- no __dirname). Location-independent, so
    // every package's copy of this file is byte-identical.
    public static PackageSrc(fromUrl: string): string
    {
        let dir = dirname(fileURLToPath(fromUrl));
        while (!existsSync(join(dir, "package.json"))) dir = dirname(dir);
        return join(dir, "src");
    }

    public static Walk(dir: string, out: string[]): void
    {
        for (const name of readdirSync(dir))
        {
            if (name === "node_modules" || name === "dist") continue;
            const p = join(dir, name);
            if (statSync(p).isDirectory()) { SchemeMembershipScan.Walk(p, out); continue; }
            if (p.endsWith(".mu") || (p.endsWith(".ts") && !p.endsWith(SchemeMembershipScan.TestFile))) out.push(p);
        }
    }

    public static Offenders(fromUrl: string, forbidden: ReadonlySet<string>): string[]
    {
        const files: string[] = [];
        SchemeMembershipScan.Walk(SchemeMembershipScan.PackageSrc(fromUrl), files);
        const hits: string[] = [];
        for (const file of files)
        {
            const text = readFileSync(file, "utf8");
            if (file.endsWith(".mu")) hits.push(...SchemeMembershipScan.ScanMu(file, text, forbidden));
            else hits.push(...SchemeMembershipScan.ScanTs(file, text, forbidden));
        }
        return hits;
    }
}

test("the forbidden set is derived from Material and excludes shared Pragmatic tokens", () =>
{
    const forbidden = SchemeMembershipScan.ForbiddenTokens();
    // Exhaustive: tokens a hand-list missed are all in the derived Material vocabulary.
    assert.ok(forbidden.has("OnSurface"), "OnSurface should be forbidden");
    assert.ok(forbidden.has("OnSurfaceVariantHoverLayer"), "state-layer token should be forbidden");
    assert.ok(forbidden.has("StatePressOverlay"), "state overlay token should be forbidden");
    assert.ok(forbidden.has("DiagramCanvas"), "DiagramCanvas should be forbidden");
    // Shared token excluded; a Pragmatic-native token is never forbidden.
    assert.ok(!forbidden.has("Scrim"), "Scrim is defined by both themes -> not forbidden");
    assert.ok(!forbidden.has("Fg1"), "Fg1 is a Pragmatic token -> not forbidden");
});

test("ScanMu flags only forbidden tokens, not native or local references", () =>
{
    const forbidden = new Set(["OnSurface"]);
    const hits = SchemeMembershipScan.ScanMu("x.mu", "a = @OnSurface\nb = @Fg1\nc = @RowsPanel", forbidden);
    assert.equal(hits.length, 1);
    const [first] = hits;
    assert.ok(first !== undefined);
    assert.match(first, /x\.mu:1 @OnSurface/);
});

test("this package carries no Material tokens or Material import", () =>
{
    const offenders = SchemeMembershipScan.Offenders(import.meta.url, SchemeMembershipScan.ForbiddenTokens());
    assert.deepEqual(offenders, [], `Material references remain:\n${offenders.join("\n")}`);
});
