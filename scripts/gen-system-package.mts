// Generate src/compiler-services/stdlib/system/system-package.generated.ts from system.todl (ruling T10). The compiled
// todl.system package document is embedded as a constant so runtime compiles nothing and the package survives
// bundling. system.todl stays the hand-editable source of truth; `npm run build` runs this after gen:prelude.
import { readFileSync, writeFileSync } from 'node:fs';
import { compilePackage } from '../src/publish/publish.js';
import { SecurityNames } from '../src/compiler-services/security/security-names.js';

class SystemPackageGenerator
{
    private static readonly Source = new URL('../src/compiler-services/stdlib/system/system.todl', import.meta.url);
    private static readonly Target = new URL('../src/compiler-services/stdlib/system/system-package.generated.ts', import.meta.url);
    private static readonly SourceUri = 'system.todl';
    private static readonly Utf8 = 'utf8';
    private static readonly Indent = 4;
    private static readonly Header = '// GENERATED from system.todl by scripts/gen-system-package.mts — do not edit by hand.';
    private static readonly Wrote = 'wrote src/compiler-services/stdlib/system/system-package.generated.ts';
    private static readonly ImportLine = "import type { PackageDocument } from '../../../publish/publish.js';";
    private static readonly ClassName = 'SystemPackageDocument';
    private static readonly DocComment = '/** The compiled {0} package document (own-only; the prelude is implicit). */';
    private static readonly CastComment = '    // The model.json shape: enum members are their serialized string values, hence the cast.';
    private static readonly Placeholder = '{0}';
    private static readonly At = '@';

    public static Run(): void
    {
        const text = readFileSync(SystemPackageGenerator.Source, SystemPackageGenerator.Utf8);
        const out = compilePackage([], [{ uri: SystemPackageGenerator.SourceUri, text }], { id: SecurityNames.SystemModel, version: SecurityNames.SystemVersion });
        if (!out.ok || out.package === undefined)
        {
            throw new Error(JSON.stringify(out.errors, null, SystemPackageGenerator.Indent));
        }
        const json = JSON.stringify(out.package.document, null, SystemPackageGenerator.Indent)
            .split('\n')
            .join('\n' + ' '.repeat(SystemPackageGenerator.Indent));
        const identity = SecurityNames.SystemModel + SystemPackageGenerator.At + SecurityNames.SystemVersion;
        const lines = [
            SystemPackageGenerator.Header,
            SystemPackageGenerator.ImportLine,
            '',
            SystemPackageGenerator.DocComment.replace(SystemPackageGenerator.Placeholder, identity),
            `export class ${SystemPackageGenerator.ClassName}`,
            '{',
            SystemPackageGenerator.CastComment,
            `    public static readonly Document: PackageDocument = ${json} as unknown as PackageDocument;`,
            '}',
            '',
        ];
        writeFileSync(SystemPackageGenerator.Target, lines.join('\n'));
        console.log(SystemPackageGenerator.Wrote);
    }
}

SystemPackageGenerator.Run();
