// The published meta-model package descriptor. manifest.json is a DISTINCT artifact
// from the project's on-disk envelope (project.plexus / MetaModelManifest); it mirrors
// library.json: identity plus the package-level annotations projected from the model
// graph, so a consumer can understand a package without parsing model.json.
export interface MetaModelManifestFile
{
    id: string
    version: string
    name: string
    description?: string
    annotations: Record<string, Record<string, unknown>>
}
