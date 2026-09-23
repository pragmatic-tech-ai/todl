import type { IGraphQuery } from "../graph-query.js";
import { Snapshot } from "../snapshot.js";
import type { InstanceMirror } from "../../manifest/reflection/reflection.js";

// A deliberately minimal three-pane explorer: concepts -> instances -> instance detail.
// Proves the reflection-native query end-to-end; not a product UI.
export class GraphExplorer
{
    private static readonly ConceptsTitle = "Concepts";
    private static readonly InstancesTitle = "Instances";
    private static readonly DetailTitle = "Detail";

    private readonly instances: HTMLElement;
    private readonly detail: HTMLElement;

    constructor(private readonly api: IGraphQuery, private readonly host: HTMLElement)
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
            item.textContent = Snapshot.ofType(concept).label;
            item.addEventListener("click", () => this.ShowInstances(concept.fullName));
            list.appendChild(item);
        }
        return list;
    }

    private ShowInstances(conceptId: string): void
    {
        const list = this.instances.querySelector("ul")!;
        list.innerHTML = "";
        for (const mirror of this.api.InstancesOf(conceptId))
        {
            const item = document.createElement("li");
            item.textContent = Snapshot.LabelOf(mirror);
            item.addEventListener("click", () => this.ShowDetail(mirror));
            list.appendChild(item);
        }
    }

    private ShowDetail(mirror: InstanceMirror): void
    {
        const pre = this.detail.querySelector("pre")!;
        pre.textContent = JSON.stringify(Snapshot.of(mirror), null, 2);
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
