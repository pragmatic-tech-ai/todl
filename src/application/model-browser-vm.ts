import { Observable, ObservableCollection } from "@pragmatic-tech-ai/mural/runtime";
import type { ModelDataSource } from "../model-data/model-data-source.js";

// The header row for a concept that has instances.
export class ConceptHeaderVM extends Observable
{
    constructor(private readonly concept: string)
    {
        super();
    }

    public get Concept(): string
    {
        return this.concept;
    }
}

// A single instance row (its id) or the empty-state message.
export class InstanceRowVM extends Observable
{
    constructor(private readonly text: string)
    {
        super();
    }

    public get Text(): string
    {
        return this.text;
    }
}

// A flat, heterogeneous list of header + instance rows over a model's instances,
// grouped by concept. The ItemsControl in model-browser.mu stamps one DataTemplate
// per row type. Static data → plain getters (the $-binding reads once at stamp time).
export class ModelBrowserVM extends Observable
{
    private static readonly EmptyStateText = "No instances to display.";

    public readonly Rows: ObservableCollection<Observable>;

    constructor(root: ModelDataSource | undefined)
    {
        super();
        const rows: Observable[] = [];
        if (root !== undefined)
        {
            for (const concept of root.ConceptNames())
            {
                const instances = root.Instances(concept);
                if (instances.length === 0)
                {
                    continue;
                }
                rows.push(new ConceptHeaderVM(concept));
                for (const instance of instances)
                {
                    rows.push(new InstanceRowVM(instance.id));
                }
            }
        }
        if (rows.length === 0)
        {
            rows.push(new InstanceRowVM(ModelBrowserVM.EmptyStateText));
        }
        this.Rows = new ObservableCollection<Observable>(rows);
    }

    public static For(root: ModelDataSource | undefined): ModelBrowserVM
    {
        return new ModelBrowserVM(root);
    }
}
