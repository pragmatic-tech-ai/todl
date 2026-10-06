import { NodeIdQualifier } from "../../../compiler-services/parse/node-id-qualifier.js";
import { PRELUDE_NAMESPACE } from "../../../compiler-services/stdlib/prelude.js";
import type { Repository } from "../../../compiler-services/model/model.js";
import type { AnalysisSnapshot } from "./analysis-snapshot.js";

// Translates an AS-WRITTEN symbol (what the editor's own AST/indexes hold) into the
// canonical namespace-qualified node id the Model is keyed by. Mirrors the loader's
// resolution precedence: written-as-qualified, home namespace, imports, prelude.
export class WrittenSymbolResolver
{
    public static ResolveFor(written: string, fileNamespace: string | null, imports: readonly string[], model: Repository): string | undefined
    {
        if (model.has(written)) return written;
        const home = NodeIdQualifier.Qualify(fileNamespace, written);
        if (model.has(home)) return home;
        for (const imp of imports)
        {
            const candidate = NodeIdQualifier.Qualify(imp, written);
            if (model.has(candidate)) return candidate;
        }
        const prelude = NodeIdQualifier.Qualify(PRELUDE_NAMESPACE, written);
        return model.has(prelude) ? prelude : undefined;
    }

    // Resolve a symbol written in the given file, taking the file's namespace + imports
    // from the snapshot's already-parsed AST.
    public static ResolveIn(a: AnalysisSnapshot, uri: string, written: string): string | undefined
    {
        const ast = a.Sources.get(uri)?.ast;
        const ns = ast === undefined || ast.path === "" ? null : ast.path;
        return WrittenSymbolResolver.ResolveFor(written, ns, ast?.imports ?? [], a.Model);
    }
}
