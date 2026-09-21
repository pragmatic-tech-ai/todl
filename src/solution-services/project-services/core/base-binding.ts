// A reference to a published base model, by publish id + version. The compiled
// artifact lives at `<id>/<version>/model.json` in the shared package store.
export interface PublishedBaseModelReference
{
    id: string
    version: string
}

// The base models a consuming project is authored against. Meta-models and libraries
// are the same internally — both are just base references resolved uniformly; the two
// lists are kept only as the user-facing management distinction (a meta-model is the
// schema, libraries are content). A project may reference any number of each. Persisted
// on the project manifest.
export interface ProjectBaseModelBindings
{
    metaModels?: readonly PublishedBaseModelReference[]
    libraries?: readonly PublishedBaseModelReference[]
}
