# Amazon Kendra

## Purpose

ML-powered enterprise search. Indexes scattered repositories so employees and customers find content even when it sits across multiple stores; competes with semantic-search and RAG retrieval.

## Trade-offs

- High per-month floor cost. Even the Developer Edition runs
  hundreds of dollars; Enterprise Edition is meaningfully more.
  Pilot projects regularly bounce off the bill before producing
  a working index.
- vs. OpenSearch + a vector model + a reranker: building RAG on
  open primitives is more work but cheaper and more controllable
  than Kendra at sustained scale. Kendra wins on speed-to-first-
  result and on managed connectors (SharePoint, Confluence,
  ServiceNow); custom stacks win on cost and customisation.
- Q Business now covers most "enterprise RAG assistant" use cases
  Kendra used to anchor. New work targeting a chatbot-style
  interface usually starts with Q Business and reaches for
  Kendra only if Q Business's data-source coverage misses.
