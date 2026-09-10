import {
    GridProperty, PropertyKind, MapPropertyBag, SettingKind,
    type IPropertyBag, type PropertyAccessor,
} from '@pragmatic-tech-ai/mural/framework'
import { type SolutionSettingBag } from './solution-setting-bag.js'

// Bridges a live SolutionSettingBag to the PropertyGrid: maps each field's
// SettingKind to a PropertyKind, produces the GridProperty descriptors, and wraps
// the bag's values in a MapPropertyBag whose accessors read/write the bag (so an
// edit flows straight through to the session's dirty tracking).
export class SettingBagGrid {
    static kindOf(kind: SettingKind): PropertyKind {
        switch (kind) {
            case SettingKind.Boolean: return PropertyKind.Boolean
            case SettingKind.Number:  return PropertyKind.Number
            case SettingKind.Choice:  return PropertyKind.Enum
            case SettingKind.Color:   return PropertyKind.Color
            case SettingKind.String:
            case SettingKind.FilePath:
            default:                  return PropertyKind.Text
        }
    }

    static describe(bag: SolutionSettingBag): GridProperty[] {
        return bag.Definition.Fields.map((f) => {
            const opts = { displayName: f.Label || f.Key, category: bag.Definition.Title, description: f.Description }
            switch (SettingBagGrid.kindOf(f.Kind)) {
                case PropertyKind.Boolean: return GridProperty.bool(f.Key, opts)
                case PropertyKind.Number:  return GridProperty.number(f.Key, opts)
                case PropertyKind.Enum:    return GridProperty.enumOf(f.Key, f.Choices ? f.Choices.ToArray() : [], opts)
                case PropertyKind.Color:   return GridProperty.color(f.Key, opts)
                default:                   return GridProperty.text(f.Key, opts)
            }
        })
    }

    static bagOf(bag: SolutionSettingBag): IPropertyBag {
        const accessors = new Map<string, PropertyAccessor>()
        for (const f of bag.Definition.Fields) {
            accessors.set(f.Key, {
                get: () => bag.Get(f.Key),
                set: (v: unknown) => bag.Set(f.Key, v as string | number | boolean),
            })
        }
        return new MapPropertyBag(accessors)
    }
}
