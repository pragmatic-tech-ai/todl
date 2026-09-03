# Amazon CloudSearch

## Purpose

Managed search index for websites and applications. 34-language support with autocomplete, highlighting, faceting, and geospatial search.

## Trade-offs

- Effectively superseded by OpenSearch Service. AWS has not added
  meaningful CloudSearch features in years; the engine sits in
  maintenance mode while OpenSearch absorbs investment and
  ecosystem.
- Smaller feature surface than OpenSearch: no aggregations beyond
  facets, no kNN/vector search, no Lucene-class scoring controls.
  Workloads that look more sophisticated than "search the
  catalogue" quickly outgrow what CloudSearch offers.
- New search workloads should land on OpenSearch Service or
  OpenSearch Serverless. The only reason to stay on CloudSearch
  today is an existing investment that has not yet justified a
  migration.
