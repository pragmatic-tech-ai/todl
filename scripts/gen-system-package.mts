// Generate src/engine-bridge/system/system-package.generated.ts from system.todl (ruling T10). The compiled
// todl.system package document is embedded as a constant so runtime compiles nothing and the package survives
// bundling. system.todl stays the hand-editable source of truth; `npm run build` runs this after gen:prelude.
import { readFileSync, writeFileSync } from 'node:fs';
import { compilePackage } from '../src/publish/publish.js';
import { SystemNames } from '../src/engine-bridge/system/SystemNames.js';

class SystemPackageGenerator
{
    private static readonly Source = new URL('../src/engine-bridge/system/system.todl', import.meta.url);
    private static readonly Target = new URL('../src/engine-bridge/system/system-package.generated.ts', import.meta.url);
    private static readonly SourceUri = 'system.todl';
    private static readonly Utf8 = 'utf8';
    private static readonly Indent = 4;
    private static readonly Header = '// GENERATED from system.todl by scripts/gen-system-package.mts — do not edit by hand.';
    private static readonly Wrote = 'wrote src/engine-bridge/system/system-package.generated.ts';

    public static Run(): void
    {
        const text = readFileSync(SystemPackageGenerator.Source, SystemPackageGenerator.Utf8);
        const out = compilePackage([], [{ uri: SystemPackageGenerator.SourceUri, text }], { id: SystemNames.Model, version: SystemNames.Version });
        if (!out.ok || out.package === undefined)
        {
            throw new Error(JSON.stringify(out.errors, null, SystemPackageGenerator.Indent));
        }
        const json = JSON.stringify(out.package.document, null, SystemPackageGenerator.Indent)
            .split('\n')
            .join('\n' + ' '.repeat(SystemPackageGenerator.Indent));
        const lines = [
            SystemPackageGenerator.Header,
            "import type { PackageDocument } from '../../publish/publish.js';",
            '',
            `/** The compiled ${SystemNames.Model}@${SystemNames.Version} package document (own-only; the prelude is implicit). */`,
            'export class SystemPackageDocument',
            '{',
            '    // The model.json shape: enum members are their serialized string values, hence the cast.',
            `    public static readonly Document: PackageDocument = ${json} as unknown as PackageDocument;`,
            '}',
            '',
        ];
        writeFileSync(SystemPackageGenerator.Target, lines.join('\n'));
        console.log(SystemPackageGenerator.Wrote);
    }
}

SystemPackageGenerator.Run();
