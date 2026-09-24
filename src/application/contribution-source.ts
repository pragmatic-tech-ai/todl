import type { CompositionRoot } from "@pragmatic-tech-ai/todl-runtime";

// One thing an application contributes to a composition. The bootstrapper applies
// a list of these in order. Data is one contribution today; compiled `.modules:`
// behavior and the Mural host (Wave 3c) slot into the same list unchanged.
export interface IContributionSource
{
    Contribute(root: CompositionRoot): void | Promise<void>;
}
