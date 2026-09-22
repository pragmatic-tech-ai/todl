import type { GraphApi } from "../graph-api.js";
import type { EntitySummary } from "../dto.js";

// A deliberately minimal three-pane explorer: concepts -> instances -> entity detail.
// Proves the GraphApi end-to-end; not a product UI.
export class GraphExplorer
{
    private static readonly ConceptsTitle = "Concepts";
    private static readonly InstancesTitle = "Instances";
    private static readonly DetailTitle = "Detail";

    private readonly instances: HTMLElement;
    private readonly detail: HTMLElement;

    constructor(private readonly api: GraphApi, private readonly host: HTMLElement)
    {
        this.host.innerHTML = "";
        this.host.appendChild(this.Column(GraphExplorer.ConceptsTitle, this.ConceptsList()));
        this.instances = this.Column(GraphExplorer.InstancesTitle, document.createElement("ul"));
        this.detail = this.Column(GraphExplorer.DetailTitle, document.createElement("pre"));
        this.host.appendChild(this.instances);
        this.host.appendChild(this.detail);
    }

    public Render(): void
    {
        // Construction already rendered the concepts column; nothing further to do.
    }

    private ConceptsList(): HTMLElement
    {
        const list = document.createElement("ul");
        for (const concept of this.api.Concepts())
        {
            const item = document.createElement("li");
            item.textContent = concept.label;
            item.addEventListener("click", () => this.ShowInstances(concept.id));
            list.appendChild(item);
        }
        return list;
    }

    private ShowInstances(conceptId: string): void
    {
        const list = this.instances.querySelector("ul")!;
        list.innerHTML = "";
        for (const entity of this.api.InstancesOf(conceptId))
        {
            const item = document.createElement("li");
            item.textContent = entity.label;
            item.addEventListener("click", () => this.ShowDetail(entity));
            list.appendChild(item);
        }
    }

    private ShowDetail(entity: EntitySummary): void
    {
        const pre = this.detail.querySelector("pre")!;
        pre.textContent = JSON.stringify(this.api.Entity(entity.id), null, 2);
    }

    private Column(title: string, body: HTMLElement): HTMLElement
    {
        const column = document.createElement("section");
        const heading = document.createElement("h2");
        heading.textContent = title;
        column.appendChild(heading);
        column.appendChild(body);
        return column;
    }
}
