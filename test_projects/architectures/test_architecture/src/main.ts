import { Application } from "@pragmatic-tech-ai/mural";
import { Observable } from "@pragmatic-tech-ai/mural/runtime";
import { model } from "../generated/data.js";

export class TodlTestArchApp extends Observable
{
    constructor()
    {
        super();
        Application.current?.Services.addInstance(this);
    }

    public get HelloText(): string
    {
        return "Hello from todl-test-arch";
    }

    public get ConceptSummary(): string
    {
        return `The application has access to ${model.ConceptNames().length} concepts`;
    }
}

new TodlTestArchApp();
