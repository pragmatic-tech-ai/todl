// Plain-data projections returned by GraphApi. Kept transport-agnostic (pure JSON) so
// the same contract can later back an HTTP or piped process, not just the in-process page.
export interface ConceptSummary
{
    id: string;
    label: string;
    namespace: string;
}

export interface EntitySummary
{
    id: string;
    concept: string;
    label: string;
    iconKey?: string;
}
