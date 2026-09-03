/**
 * Runtime handles — the meta/domain split as distinct types (design:
 * todl-runtime-surface §8). Each handle is a thin, id-backed live lens over the
 * composed {@link Repository}: `TodlDefinition` is the meta (concept) tier,
 * `Instance` is the domain tier, and `Model` is an instance container. Reads
 * delegate to the repository, so `EdgeKind`/`Tier`/attrs never leak to a caller.
 */
import { MetaKind } from "../model/kinds.js";
import { EdgeKind, Direction, Tier, type NodeId } from "../model/graph.js";
import type { Repository } from "../model/model.js";

/** A node's readable name: its `name` attr, else its `id` attr, else the raw id. */
function nameOf(repo: Repository, id: NodeId): string {
  return String(repo.attr(id, "name") ?? repo.attr(id, "id") ?? id);
}

/** The meta handle: a concept (the type tier). Answers identity/subtype queries. */
export class TodlDefinition {
  constructor(
    private readonly repo: Repository,
    readonly Id: NodeId,
  ) {}

  get Name(): string {
    return String(this.repo.attr(this.Id, "name") ?? this.Id);
  }

  /** True if this definition is `other` or a subtype of it (via `extends`). */
  Is(other: TodlDefinition): boolean {
    return this.Id === other.Id || this.repo.supertypesOf(this.Id).includes(other.Id);
  }
}

/** The domain handle: a concrete instance living in a model. */
export class Instance {
  constructor(
    private readonly repo: Repository,
    readonly Id: NodeId,
  ) {}

  get Name(): string {
    return nameOf(this.repo, this.Id);
  }

  /** The concept this instance is a `typeOf`. */
  get Definition(): TodlDefinition {
    return new TodlDefinition(this.repo, this.repo.resolve(this.Id)?.typeOf ?? "");
  }

  /** A scalar member value by name. */
  GetValue(name: string): string | number | boolean | undefined {
    return this.repo.attr(this.Id, name);
  }

  /** The instances this one references through `member`. */
  GetReferences(member: string): Instance[] {
    return this.repo.refs(this.Id, member).map((id) => new Instance(this.repo, id));
  }
}

/** An instance container. Its definition (name, bound schema) is fixed by the
 *  assembly; its population arrives through a {@link ModelSource}. */
export class Model {
  constructor(
    private readonly repo: Repository,
    readonly Id: NodeId,
  ) {}

  get Name(): string {
    return nameOf(this.repo, this.Id);
  }

  /** The distinct concept-definitions whose instances appear in this model. */
  GetDefinitions(): TodlDefinition[] {
    const seen = new Set<NodeId>();
    const out: TodlDefinition[] = [];
    for (const id of this.instances()) {
      const concept = this.repo.resolve(id)?.typeOf;
      if (concept === undefined || seen.has(concept)) continue;
      if (this.repo.resolve(concept)?.typeOf !== MetaKind.Concept) continue;
      seen.add(concept);
      out.push(new TodlDefinition(this.repo, concept));
    }
    return out;
  }

  /** Every instance in this model of `def` — polymorphically, i.e. including
   *  instances whose concept is a subtype of `def`. */
  GetInstances(def: TodlDefinition): Instance[] {
    return this.instances()
      .filter((id) => {
        const concept = this.repo.resolve(id)?.typeOf;
        return concept !== undefined && (concept === def.Id || this.repo.supertypesOf(concept).includes(def.Id));
      })
      .map((id) => new Instance(this.repo, id));
  }

  /** The instance-tier nodes contained by this model (any depth). */
  private instances(): NodeId[] {
    return this.repo
      .closure(this.Id, EdgeKind.Contains, Direction.Out, false)
      .filter((id) => this.repo.resolve(id)?.tier === Tier.Instance);
  }
}
