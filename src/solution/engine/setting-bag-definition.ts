import { type SettingDefinition } from '@pragmatic-tech-ai/mural/framework'

// A named, solution-scoped group of typed setting fields (e.g. "npm-registry").
// Reuses Mural's SettingDefinition for each field, so the same schema drives the
// PropertyGrid editor. Contributed to SolutionSettingsRegistry by the host.
export class SettingBagDefinition
{
    constructor(
        public readonly Id: string,
        public readonly Title: string,
        public readonly Fields: readonly SettingDefinition[],
    ) {}
}
