// A typed key into the BuildArtifacts bag — the hot-value channel between build
// actions (spec §2.2). Modeled on ServiceKey: identity is the object, not the
// description, so two keys sharing a description are distinct slots. The phantom
// `__artifact_type__` carries T for inference and never exists at runtime.
export class ArtifactKey<T>
{
    public readonly Description: string;
    public declare readonly __artifact_type__: T;

    constructor(description: string)
    {
        this.Description = description;
    }

    public toString(): string
    {
        return `ArtifactKey(${this.Description})`;
    }
}
