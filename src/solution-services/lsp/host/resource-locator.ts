import type { IStorage } from '@pragmatic-tech-ai/todl-runtime';
import { Repository } from '../../../compiler-services/model/model.js';
import { EdgeKind, Direction } from '../../../compiler-services/model/graph.js';
import { WikiLocator, type WikiOrigin } from '../../project-services/core/wiki-origin.js';

export interface ResolvedResource
{
    annotation: string;
    storage: IStorage;
    path: string;
}

/**
 * Finds every annotation application on a node that is-a MuralResource and carries a
 * path, resolving that path to a concrete storage via the node's source origin.
 */
export class ResourceLocator
{
    private static readonly ResourceBaseAnnotation = 'todl.MuralResource';
    private static readonly PathAttr = 'path';

    public constructor(
        private readonly model: Repository,
        private readonly originOf: ReadonlyMap<string, WikiOrigin>,
        private readonly packagesStorage: IStorage,
    )
    {
    }

    public Resources(nodeId: string): ResolvedResource[]
    {
        const out: ResolvedResource[] = [];
        for (const appId of this.model.related(nodeId, EdgeKind.Annotated, Direction.Out))
        {
            const app = this.model.resolve(appId);
            if (app === undefined || app.type === null) continue;
            const isResource = app.type === ResourceLocator.ResourceBaseAnnotation
                || this.model.supertypesOf(app.type).includes(ResourceLocator.ResourceBaseAnnotation);
            if (!isResource) continue;
            const path = app.attrs.get(ResourceLocator.PathAttr);
            if (typeof path !== 'string' || path.length === 0) continue;
            const origin = this.originOf.get(nodeId);
            if (origin === undefined) continue;
            const located = WikiLocator.LocateFile(this.packagesStorage, origin, path);
            out.push({ annotation: app.type, storage: located.storage, path: located.path });
        }
        return out;
    }
}
