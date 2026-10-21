import ts from "typescript";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { Severity, type BuildDiagnostic } from "../../../build-system-core/diagnostic-sink.js";
import type { ITypeChecker, TypeCheckRequest, TypeCheckResult } from "../../../build-system-core/type-checker.js";
import type { CanonicalCompilerOptions } from "../../../build-system-core/compiler-options.js";

// Node-only ITypeChecker: stages the request's files into a dir created INSIDE the
// nearest node_modules root (so tsc resolves the real installed
// "@pragmatic-tech-ai/*" .d.ts), builds a ts.Program with the canonical options,
// and returns semantic + syntactic diagnostics. Failures are reported as
// Severity.Error diagnostics, never thrown — mirroring EsbuildBundler.
export class TscTypeChecker implements ITypeChecker
{
    private static readonly Source = "type-check";
    private static readonly StagePrefix = "todl-tsc-stage-";
    private static readonly NodeModulesDirectory = "node_modules";
    private static readonly TypeScriptModule = "typescript";
    private static readonly NoResolutionRootMessage =
        "could not locate a node_modules root to resolve the project's type imports against";
    private static readonly CheckFailedPrefix = "failed to type-check the project: ";
    private static readonly MessageNewline = "\n";

    public async Check(request: TypeCheckRequest): Promise<TypeCheckResult>
    {
        const resolutionRoot = this.ResolutionRoot();
        if (resolutionRoot === undefined)
        {
            return TscTypeChecker.Failure(TscTypeChecker.NoResolutionRootMessage);
        }

        let stageDir: string | undefined;
        try
        {
            stageDir = mkdtempSync(join(resolutionRoot, TscTypeChecker.StagePrefix));
            const rootNames: string[] = [];
            for (const file of request.Files)
            {
                const abs = join(stageDir, file.Path);
                mkdirSync(dirname(abs), { recursive: true });
                writeFileSync(abs, file.Text);
                rootNames.push(abs);
            }
            const options = TscTypeChecker.MapOptions(request.Options);
            const program = ts.createProgram(rootNames, options, TscTypeChecker.HostFor(options));
            const diagnostics = [
                ...program.getGlobalDiagnostics(),
                ...program.getSyntacticDiagnostics(),
                ...program.getSemanticDiagnostics(),
            ];
            return { Diagnostics: diagnostics.map((d) => TscTypeChecker.ToBuildDiagnostic(d)) };
        }
        catch (err)
        {
            const detail = err instanceof Error ? err.message : String(err);
            return TscTypeChecker.Failure(`${TscTypeChecker.CheckFailedPrefix}${detail}`);
        }
        finally
        {
            if (stageDir !== undefined) rmSync(stageDir, { recursive: true, force: true });
        }
    }

    // Map the plain canonical strings to ts enum values. Unknown/missing names fall
    // back to the ts default for that option.
    private static MapOptions(options: CanonicalCompilerOptions): ts.CompilerOptions
    {
        return {
            target: ts.ScriptTarget[options.Target as keyof typeof ts.ScriptTarget] ?? ts.ScriptTarget.ES2020,
            module: ts.ModuleKind[options.Module as keyof typeof ts.ModuleKind] ?? ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind[options.ModuleResolution as keyof typeof ts.ModuleResolutionKind]
                ?? ts.ModuleResolutionKind.Bundler,
            jsx: ts.JsxEmit[options.Jsx as keyof typeof ts.JsxEmit] ?? ts.JsxEmit.Preserve,
            lib: options.Lib.map((l) => `lib.${l.toLowerCase()}.d.ts`),
            strict: options.Strict,
            noEmit: options.NoEmit,
            skipLibCheck: options.SkipLibCheck,
            esModuleInterop: options.EsModuleInterop,
        };
    }

    // A compiler host whose default-lib directory points at the INSTALLED typescript
    // package's lib/ (holding lib.es2020.d.ts, lib.dom.d.ts, ...). TypeScript's own
    // default host derives that directory from its executing-file path, which is wrong
    // whenever typescript is bundled (e.g. into an Electron main process): the path then
    // points at the host bundle, no lib.*.d.ts loads, and every global type is reported
    // missing ("Cannot find global type 'Array'", "Cannot find name 'Map'/'window'").
    // Resolving the real package location keeps the gate correct in every environment.
    private static HostFor(options: ts.CompilerOptions): ts.CompilerHost
    {
        const host = ts.createCompilerHost(options);
        const libDir = TscTypeChecker.TsLibDirectory();
        if (libDir !== undefined)
        {
            host.getDefaultLibLocation = () => libDir;
        }
        return host;
    }

    // The installed typescript package's lib/ directory, resolved from the package entry
    // rather than ts's self-location. Undefined if typescript cannot be resolved (then the
    // host keeps its default behavior).
    private static TsLibDirectory(): string | undefined
    {
        try
        {
            return dirname(createRequire(import.meta.url).resolve(TscTypeChecker.TypeScriptModule));
        }
        catch
        {
            return undefined;
        }
    }

    private static ToBuildDiagnostic(d: ts.Diagnostic): BuildDiagnostic
    {
        const message = ts.flattenDiagnosticMessageText(d.messageText, TscTypeChecker.MessageNewline);
        const severity = d.category === ts.DiagnosticCategory.Error ? Severity.Error : Severity.Warning;
        return { severity, message, source: TscTypeChecker.Source };
    }

    private static Failure(message: string): TypeCheckResult
    {
        return { Diagnostics: [{ severity: Severity.Error, message, source: TscTypeChecker.Source }] };
    }

    // Nearest ancestor directory containing a node_modules folder (todl checkout
    // root in-repo, or the consumer's package root when installed). protected so a
    // test can point it at a fixture root — mirrors EsbuildBundler.ResolutionRoot.
    protected ResolutionRoot(): string | undefined
    {
        let dir = dirname(fileURLToPath(import.meta.url));
        while (true)
        {
            if (existsSync(join(dir, TscTypeChecker.NodeModulesDirectory))) return dir;
            const parent = dirname(dir);
            if (parent === dir) return undefined;
            dir = parent;
        }
    }
}
