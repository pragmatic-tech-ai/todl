// A reference to a published base model, by publish id + version. The compiled
// artifact lives at `<id>/<version>/model.json` in its backend (meta-models or
// libraries).
export interface PublishedBaseModelReference
{
    id: string
    version: string
}

// The base models a consuming project is authored against. A meta-model project
// declares none; a library declares a meta-model; an architecture declares a
// meta-model plus libraries. Persisted on the project manifest.
export interface ProjectBaseModelBindings
{
    metaModel?: PublishedBaseModelReference
    libraries?: readonly PublishedBaseModelReference[]
}
