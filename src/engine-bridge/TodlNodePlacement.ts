import type { CellValue, Cypher } from '@pragmatic-tech-ai/graph';
import { SnowflakeIdGenerator, type IdGenerator } from '../compiler-services/model/id-generator.js';

/**
 * Places the nodes a Cypher CREATE / MERGE makes in one TODL model: public id `${namespace}.${minted id}` (the id
 * form the model's instances carry, so the file connector can write it) and the model as owner.
 */
export class TodlNodePlacement implements Cypher.INodePlacement
{
    private static readonly Separator = '.';

    public constructor(
        private readonly model: string,
        private readonly namespace: string,
        private readonly ids: IdGenerator = new SnowflakeIdGenerator(),
    )
    {
    }

    public Place(_concept: string, _properties: ReadonlyMap<string, CellValue>): ReturnType<Cypher.INodePlacement['Place']>
    {
        return { PublicId: this.namespace + TodlNodePlacement.Separator + this.ids.next(), Owner: this.model };
    }
}
