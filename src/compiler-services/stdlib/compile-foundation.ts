import type { TodlDocument } from "../emit/json.js";
import type { Repository } from "../model/model.js";
import { preludeDocument } from "./prelude.js";
import { SystemPackageDocument } from "./system/system-package.generated.js";
import { SecurityNames } from "../security/security-names.js";

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
  private static readonly None: ReadonlySet<string> = new Set();
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

  /**
   * Is the package dependency `id` satisfied by the implicit foundation (the seeded `todl.system`), so a resolver
   * must not fetch it as a base?
   */
  public static ProvidesDependency(id: string): boolean
  {
    return id === SecurityNames.SystemModel;
  }

  /**
   * The system node ids a compiled closure carries only because the foundation seeded them: every system node when no
   * non-system node of `document` references one (through an edge, a node type, a class or a field type), otherwise
   * none. Under `PreludeOnly` the system nodes are the package's own, so none are unused.
   */
  public static UnusedSystemIds(kind: FoundationKind, document: TodlDocument): ReadonlySet<string>
  {
    if (kind === FoundationKind.PreludeOnly)
    {
      return CompileFoundation.None;
    }
    const ids = CompileFoundation.SystemIds();
    const referenced = document.edges.some((e) => !ids.has(e.from) && ids.has(e.to))
      || document.nodes.some((n) => !ids.has(n.id)
        && ((n.type !== null && ids.has(n.type)) || (n.class !== null && ids.has(n.class)) || n.fields.some((f) => ids.has(f.type))));
    return referenced ? CompileFoundation.None : ids;
  }

  /** `document` without the system nodes (and their edges) it carries only because the foundation seeded them. */
  public static WithoutUnusedSystem(kind: FoundationKind, document: TodlDocument): TodlDocument
  {
    const unused = CompileFoundation.UnusedSystemIds(kind, document);
    if (unused.size === 0)
    {
      return document;
    }
    return {
      ...document,
      nodes: document.nodes.filter((n) => !unused.has(n.id)),
      edges: document.edges.filter((e) => !unused.has(e.from) && !unused.has(e.to)),
    };
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
