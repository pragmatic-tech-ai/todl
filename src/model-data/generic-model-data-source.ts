// A concrete, non-generated ModelDataSource: the untyped source the pre-bundled browser
// host registers per shard (the typed codegen path uses a generated subclass instead).
// The Wave 3c model browser reads only ConceptNames/Instances/Root, so no typed
// accessors or createEntity override are needed.

import { ModelDataSource } from "./model-data-source.js";
import type { IModelDataConnector } from "./model-data-connector.js";

export class GenericModelDataSource extends ModelDataSource
{
    public constructor(modelId: string, connector: IModelDataConnector)
    {
        super(connector);
        this.modelName = modelId;
    }
}
