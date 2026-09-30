import { Signal, type IPropertyBag, type IReadOnlyPropertyAccessor, type PropertyChangedEventArgs } from '@pragmatic-tech-ai/todl-runtime';

// A DYNAMIC property bag over a mutable Map of values: unlike MapPropertyBag (a fixed set
// of accessors), it holds arbitrary keys and creates accessors on demand, so a persister can
// expose a stored { name → value } record as a bag without knowing the schema up front. Each
// write updates the Map, fires the per-name change signal, and invokes the optional onChange
// callback (a persister uses it to mark its owner dirty).
export class RecordPropertyBag implements IPropertyBag
{
    private readonly signals = new Map<string, Signal<PropertyChangedEventArgs>>();

    constructor(private readonly record: Map<string, unknown>, private readonly onChange?: () => void)
    {
    }

    public *[Symbol.iterator](): Iterator<[string, IReadOnlyPropertyAccessor]>
    {
        for (const [name] of this.record) yield [name, this.accessor(name)];
    }

    public GetValue(name: string): unknown
    {
        return this.record.get(name);
    }

    public SetValue(name: string, value: unknown): void
    {
        const oldValue = this.record.get(name);
        this.record.set(name, value);
        this.signals.get(name)?.emit({ property: name, oldValue, newValue: value });
        this.onChange?.();
    }

    public IsReadOnly(_name: string): boolean
    {
        return false;
    }

    public Observe(name: string): Signal<PropertyChangedEventArgs>
    {
        let signal = this.signals.get(name);
        if (signal === undefined)
        {
            signal = new Signal<PropertyChangedEventArgs>();
            this.signals.set(name, signal);
        }
        return signal;
    }

    public dispose(): void
    {
        this.signals.clear();
    }

    private accessor(name: string): IReadOnlyPropertyAccessor
    {
        return { id: () => name, displayName: () => name, get: () => this.record.get(name) };
    }
}
