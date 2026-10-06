// Compile-time application-root resolution (design §4). Runs on the committed
// graph after the annotation-applications pass. No-op for libraries. Guarantees
// the invariant: an application document has exactly one application-marked model.

import { MetaKind, PACKAGE_NODE_ID } from "../model/kinds.js";
import type { NodeId } from "../model/graph.js";
import type { Repository } from "../model/model.js";
import { NodeIdQualifier } from "./node-id-qualifier.js";
import { type Diagnostic, DiagnosticCode, Severity } from "../diagnostics/diagnostic.js";

export class ApplicationRootPass
{
    private static readonly AnnotationName = "todl.entrypoint";
    private static readonly RootParam = "root";

    /** Resolve/mark the application root on a committed graph. No-op for libraries. */
    static Resolve(model: Repository, diagnostics: Diagnostic[]): void
    {
        const models = model.nodesOfMetaKind(MetaKind.Model);
        const marked = models.filter((m) => model.resolve(ApplicationRootPass.appId(m)) !== undefined);
        const packageApp = model.resolve(ApplicationRootPass.appId(PACKAGE_NODE_ID));

        if (marked.length === 0 && packageApp === undefined) return; // library

        if (marked.length > 1)
        {
            ApplicationRootPass.report(model, diagnostics, DiagnosticCode.ApplicationMultipleRoots,
                ApplicationRootPass.appId(marked[0]!),
                `application has ${marked.length} models marked \`entrypoint\`; exactly one may be the root`);
            return;
        }
        if (marked.length === 1) return; // already rooted (explicit mark)

        // marked.length === 0 and the package declares app-ness:
        const rootValue = packageApp?.attrs.get(ApplicationRootPass.RootParam);
        if (rootValue !== undefined)
        {
            // The authored `root` is a bare (or qualified) model name; match it against
            // the now-qualified model ids by exact id or local name.
            const rootId = String(rootValue);
            const rootModel = models.find((m) => m === rootId || NodeIdQualifier.LocalId(m) === rootId);
            if (rootModel === undefined)
            {
                ApplicationRootPass.report(model, diagnostics, DiagnosticCode.ApplicationRootNotAModel,
                    ApplicationRootPass.appId(PACKAGE_NODE_ID),
                    `application root "${rootId}" is not a model in this package`);
                return;
            }
            ApplicationRootPass.mark(model, rootModel);
            return;
        }
        if (models.length === 1)
        {
            ApplicationRootPass.mark(model, models[0]!);
            return;
        }
        ApplicationRootPass.report(model, diagnostics, DiagnosticCode.ApplicationRootUndesignated,
            ApplicationRootPass.appId(PACKAGE_NODE_ID),
            `application has ${models.length} models; designate the root with \`annotate entrypoint\` or a package-level \`root\``);
    }

    private static appId(target: NodeId): NodeId
    {
        return `${target}@${ApplicationRootPass.AnnotationName}`;
    }

    private static mark(model: Repository, modelId: NodeId): void
    {
        const builder = model.builder();
        builder.annotate(modelId, ApplicationRootPass.AnnotationName);
        builder.commit();
    }

    private static report(model: Repository, diagnostics: Diagnostic[], code: DiagnosticCode, node: NodeId, message: string): void
    {
        diagnostics.push({ code, severity: Severity.Error, message, span: model.spanOf(node), node, path: null });
    }
}
