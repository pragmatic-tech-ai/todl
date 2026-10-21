// Publish-time manifest transform. The in-repo package.json keeps a `development`
// export condition on every subpath pointing at `./src/*.ts`, so the repo's own
// `tsx --conditions=development` tests and the html-bundle build resolve to
// TypeScript source. But `src/` is NOT published (see package.json `files`), so
// that condition is a dead pointer for any consumer — and tooling that
// auto-activates the `development` condition (Vite's dev server, electron-vite's
// SSR dev build) resolves a consumer's bare `@pragmatic-tech-ai/todl` straight to
// the missing `./src/index.ts` and fails with "Failed to resolve entry".
//
// `prepack` rewrites the PUBLISHED exports to dist-only (import → dist, dropping
// `development`); `postpack` restores the working tree so in-repo development is
// unchanged. npm runs both around `npm pack`/`npm publish`, with the tarball
// captured between them.
import { readFileSync, writeFileSync, copyFileSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

class PublishManifest
{
    static RepoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
    static ManifestFile = join(PublishManifest.RepoRoot, "package.json");
    static BackupFile = join(PublishManifest.RepoRoot, "package.json.prepack-bak");
    static Encoding = "utf8";
    static Indent = 2;
    static ExportsKey = "exports";
    static ImportKey = "import";
    static DevelopmentKey = "development";
    static DefaultKey = "default";
    static StripMode = "strip";
    static RestoreMode = "restore";

    // Collapse one export entry's `import: { development, default }` down to the
    // bare `default` (dist) path, so the published condition map never offers
    // `development`. Entries without the nested shape are left untouched.
    static CollapseEntry(entry)
    {
        const conditional = entry?.[PublishManifest.ImportKey];
        if (conditional && typeof conditional === "object" && PublishManifest.DevelopmentKey in conditional)
        {
            entry[PublishManifest.ImportKey] = conditional[PublishManifest.DefaultKey];
        }
    }

    static Strip()
    {
        copyFileSync(PublishManifest.ManifestFile, PublishManifest.BackupFile);
        const pkg = JSON.parse(readFileSync(PublishManifest.ManifestFile, PublishManifest.Encoding));
        const exports = pkg[PublishManifest.ExportsKey];
        for (const key of Object.keys(exports))
        {
            PublishManifest.CollapseEntry(exports[key]);
        }
        writeFileSync(
            PublishManifest.ManifestFile,
            JSON.stringify(pkg, null, PublishManifest.Indent) + "\n",
            PublishManifest.Encoding,
        );
        console.log("strip-dev-exports: published exports are now dist-only");
    }

    static Restore()
    {
        if (!existsSync(PublishManifest.BackupFile)) return;
        copyFileSync(PublishManifest.BackupFile, PublishManifest.ManifestFile);
        rmSync(PublishManifest.BackupFile);
        console.log("strip-dev-exports: restored working-tree package.json");
    }

    static Main(mode)
    {
        if (mode === PublishManifest.StripMode)
        {
            PublishManifest.Strip();
        }
        else if (mode === PublishManifest.RestoreMode)
        {
            PublishManifest.Restore();
        }
        else
        {
            throw new Error(`strip-dev-exports: unknown mode '${mode}' (expected strip|restore)`);
        }
    }
}

PublishManifest.Main(process.argv[2]);
