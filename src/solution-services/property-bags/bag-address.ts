// The scope a property bag is persisted in. Consumers reason in three scopes; a project's
// two persisters (shared manifest vs local sidecar) are the intra-project ProjectStore detail.
export enum BagScope
{
    Global = 'global',
    Solution = 'solution',
    Project = 'project',
}

// Which of a project's two persisters a Project-scoped bag lives in.
export enum ProjectStore
{
    Shared = 'shared',   // the committed project manifest
    Local = 'local',     // the gitignored project.local.json sidecar
}

// Addresses one bag instance: its scope, kind (the SettingBagDefinition.Id), and instance id.
// ProjectStore is present only when Scope === Project. Many instances of a kind may exist within
// one scope, and instances of a kind may exist at every scope at once.
export class BagAddress
{
    constructor(
        public readonly Scope: BagScope,
        public readonly Kind: string,
        public readonly Id: string,
        public readonly ProjectStore?: ProjectStore,
    )
    {
    }

    // A stable string key: distinct addresses give distinct keys, equal addresses equal keys.
    public static Key(address: BagAddress): string
    {
        return `${address.Scope}:${address.ProjectStore ?? ''}:${address.Kind}:${address.Id}`;
    }
}
