// The single source of truth for TypeScript compiler options across Plexus: the
// renderer editor (mapped into Monaco's typescriptDefaults) and the node build
// gate (mapped into ts.CompilerOptions) both consume THIS object, so IntelliSense
// and the tsc gate never disagree on target/module/strictness. Plain string values
// (not ts/monaco enums) so it stays dependency-free and serializable; each consumer
// maps the strings to its own enum. `bundler` moduleResolution is what lets a
// `./dep.js` import resolve to the `dep.ts` model/source.
export interface CanonicalCompilerOptions
{
    readonly Target: string;
    readonly Module: string;
    readonly ModuleResolution: string;
    readonly Jsx: string;
    readonly Lib: readonly string[];
    readonly Strict: boolean;
    readonly NoEmit: boolean;
    readonly SkipLibCheck: boolean;
    readonly EsModuleInterop: boolean;
}

export const CanonicalTypeScriptOptions: CanonicalCompilerOptions = Object.freeze({
    Target: "ES2020",
    Module: "ESNext",
    ModuleResolution: "Bundler",
    Jsx: "Preserve",
    Lib: Object.freeze(["ES2020", "DOM", "DOM.Iterable"]),
    Strict: true,
    NoEmit: true,
    SkipLibCheck: true,
    EsModuleInterop: true,
});
