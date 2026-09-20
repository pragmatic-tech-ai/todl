/**
 * The population seam (design: todl-runtime-surface §7). A model's definition
 * ships in the assembly; its instances arrive through a `ModelSource`. v1 ships
 * the document source (P1 embedded / P3 deserialized — both are "a document of
 * instances"); the store-backed loader (P2, DB/HTTP) is the same seam with a
 * different implementation and lands later.
 */
import type { TodlDocument } from "../emit/json.js";

/** Something that yields a document of instances to merge into a graph. */
export interface ModelSource
{
  Load(): Promise<TodlDocument>;
}

/** Population from an in-memory compiled document (P1 embedded / P3 snapshot). */
export class DocumentSource implements ModelSource
{
  constructor(private readonly document: TodlDocument) {}

  Load(): Promise<TodlDocument>
  {
    return Promise.resolve(this.document);
  }
}
