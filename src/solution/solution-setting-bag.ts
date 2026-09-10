import { Observable } from '@pragmatic-tech-ai/todl-runtime'
import { type SettingBagDefinition } from './setting-bag-definition.js'

type Primitive = string | number | boolean

// A LIVE cross-project setting bag: a SettingBagDefinition (the schema) paired
// with current values, seeded from the field defaults and overlaid with any
// persisted values. A write marks the bag touched and notifies the session so it
// goes dirty. Extends Observable so an editor can bind per-key changes.
export class SolutionSettingBag extends Observable {
    public readonly Definition: SettingBagDefinition
    public readonly Values = new Map<string, Primitive>()
    private touched = false
    private readonly onChange: () => void

    constructor(definition: SettingBagDefinition, overlay: Record<string, Primitive> | undefined, onChange: () => void) {
        super()
        this.Definition = definition
        this.onChange = onChange
        for (const f of definition.Fields) this.Values.set(f.Key, f.Default as Primitive)
        if (overlay !== undefined) {
            for (const [k, v] of Object.entries(overlay)) { this.Values.set(k, v); this.touched = true }
        }
    }

    public get IsTouched(): boolean { return this.touched }

    public Get(key: string): Primitive | undefined { return this.Values.get(key) }

    public Set(key: string, value: Primitive): void {
        const old = this.Values.get(key)
        this.Values.set(key, value)
        this.touched = true
        this.RaisePropertyChanged(key, old, value)
        this.onChange()
    }

    public ToRecord(): Record<string, Primitive> {
        return Object.fromEntries(this.Values)
    }
}
