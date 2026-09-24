import { StackPanel, TextBlock } from "@pragmatic-tech-ai/mural/basic";
import type { Visual } from "@pragmatic-tech-ai/mural";
import type { ModelDataSource } from "../model-data/model-data-source.js";

// Builds a grouped-by-concept browser of a model's instances as an eager StackPanel:
// a header TextBlock per concept that has instances, followed by one TextBlock per
// instance (its id). Eager (not ItemsControl) — a booted bundled app's data is static.
export class ModelBrowserView
{
    private static readonly EmptyStateText = "No instances to display.";

    public static Build(root: ModelDataSource | undefined): Visual
    {
        const panel = new StackPanel();
        let any = false;
        if (root !== undefined)
        {
            for (const concept of root.ConceptNames())
            {
                const instances = root.Instances(concept);
                if (instances.length === 0) continue;
                any = true;
                panel.AddChild(ModelBrowserView.Header(concept));
                for (const instance of instances)
                {
                    panel.AddChild(ModelBrowserView.Row(instance.id));
                }
            }
        }
        if (!any) panel.AddChild(ModelBrowserView.Row(ModelBrowserView.EmptyStateText));
        return panel;
    }

    private static Header(concept: string): TextBlock
    {
        const tb = new TextBlock();
        tb.Text = concept;
        return tb;
    }

    private static Row(text: string): TextBlock
    {
        const tb = new TextBlock();
        tb.Text = text;
        return tb;
    }
}
