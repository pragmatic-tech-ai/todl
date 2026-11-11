import type { TodlDocument } from "../emit/json.js";
import type { Repository } from "../model/model.js";
import { preludeDocument } from "./prelude.js";
import { SystemPackageDocument } from "./system/system-package.generated.js";

/** Which implicit documents seed a compile. */
export enum FoundationKind
{
  /** The prelude plus `todl.system` (every package but the system package itself). */
  PreludeAndSystem = "prelude-and-system",
  /** The prelude alone (compiling `todl.system` itself). */
  PreludeOnly = "prelude-only",
}

/**
 * The implicit foundation every compile is seeded with: the prelude and, unless compiling the system package itself,
 * the `todl.system` package document (embedded at build time). A package that references a system node records
 * `todl.system` as a dependency instead of carrying its nodes.
 */
export class CompileFoundation
{
  private static readonly RedeclaredMessage = "\"{0}\" is provided by the todl.system package; remove the local declaration";
  private static readonly Placeholder = "{0}";
  private static system: TodlDocument | undefined;
  private static systemIds: ReadonlySet<string> | undefined;
  private static readonly documents = new Map<FoundationKind, readonly TodlDocument[]>();

  private constructor()
  {
  }

  /** The foundation documents: `[prelude]` or `[prelude, system document]`. */
  public static Documents(kind: FoundationKind): readonly TodlDocument[]
  {
    let documents = CompileFoundation.documents.get(kind);
    if (documents === undefined)
    {
      documents = Object.freeze(kind === FoundationKind.PreludeOnly ? [preludeDocument()] : [preludeDocument(), CompileFoundation.System()]);
      CompileFoundation.documents.set(kind, documents);
    }
    return documents;
  }

  /** The node ids of the system document. */
  public static SystemIds(): ReadonlySet<string>
  {
    CompileFoundation.systemIds ??= new Set(CompileFoundation.System().nodes.map((n) => n.id));
    return CompileFoundation.systemIds;
  }

  /** Does `document` (an own-only package document) reference a system node through an edge, a field type or a node type? */
  public static ReferencesSystem(document: TodlDocument): boolean
  {
    const ids = CompileFoundation.SystemIds();
    return document.edges.some((e) => ids.has(e.to))
      || document.nodes.some((n) => (n.type !== null && ids.has(n.type)) || n.fields.some((f) => ids.has(f.type)));
  }

  /** Is `id` a system node already seeded into `model` (so a source declaring it redeclares a system name)? */
  public static IsSeededSystemName(model: Repository, id: string): boolean
  {
    return CompileFoundation.SystemIds().has(id) && model.has(id);
  }

  /** The diagnostic message for a source that redeclares the system name `name`. */
  public static SystemNameRedeclared(name: string): string
  {
    return CompileFoundation.RedeclaredMessage.replace(CompileFoundation.Placeholder, name);
  }

  /** A private copy of the embedded system document, so the seed never aliases the served constant. */
  private static System(): TodlDocument
  {
    CompileFoundation.system ??= structuredClone(SystemPackageDocument.Document);
    return CompileFoundation.system;
  }
}
