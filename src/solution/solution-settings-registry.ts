import {
    ServiceBase, ServiceKey, ObservableCollection,
    type IServiceProvider,
} from '@pragmatic-tech-ai/mural/runtime'
import { SettingBagDefinition } from './setting-bag-definition.js'

// Aggregates the cross-project setting-bag DEFINITIONS a host contributes. Bags
// are registered imperatively (the ApplicationSettings.Contribute precedent) —
// no new Mural module block. Definitions is a bindable collection so a picker /
// settings pane can list the bags; GetById gives O(1) lookup.
export class SolutionSettingsRegistry extends ServiceBase {
    public static readonly Key = new ServiceKey<SolutionSettingsRegistry>('SolutionSettingsRegistry')

    private readonly _definitions = new ObservableCollection<SettingBagDefinition>()
    private readonly byId = new Map<string, SettingBagDefinition>()

    constructor(provider: IServiceProvider) {
        super(provider)
    }

    public static createForTest(): SolutionSettingsRegistry {
        const noProvider = {
            get: () => undefined,
            getRequired: () => { throw new Error('no container in test') },
        } as unknown as IServiceProvider
        return new SolutionSettingsRegistry(noProvider)
    }

    public get Definitions(): ObservableCollection<SettingBagDefinition> {
        return this._definitions
    }

    // Register a bag definition; idempotent by Id (a re-contribute is ignored).
    public Contribute(bag: SettingBagDefinition): void {
        if (this.byId.has(bag.Id)) return
        this.byId.set(bag.Id, bag)
        this.Definitions.Add(bag)
    }

    public GetById(id: string): SettingBagDefinition | undefined {
        return this.byId.get(id)
    }
}
