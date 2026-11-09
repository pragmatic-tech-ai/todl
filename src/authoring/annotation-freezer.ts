import { EdgeKind, type NodeId } from "../compiler-services/model/graph.js";
import type { TodlDocument } from "../compiler-services/emit/json.js";

/**
 * Freezes the annotation applications of frozen (schema) nodes: an application (`annotate x { ... }`) is a node
 * without a metaKind hanging off its element by an Annotated edge, so it belongs to that element. Iterated to a fixed
 * point, so an annotation on an annotation is frozen too, whatever the edge order.
 */
export class AnnotationFreezer
{
  private static readonly Annotated = EdgeKind[EdgeKind.Annotated];

  /** Adds to `frozen` every annotation application reachable by Annotated edges from a frozen node. */
  public static Freeze(edges: TodlDocument["edges"], frozen: Set<NodeId>): void
  {
    let grew = true;
    while (grew)
    {
      grew = false;
      for (const e of edges)
      {
        if (e.kind === AnnotationFreezer.Annotated && frozen.has(String(e.from)) && !frozen.has(String(e.to)))
        {
          frozen.add(String(e.to));
          grew = true;
        }
      }
    }
  }
}
