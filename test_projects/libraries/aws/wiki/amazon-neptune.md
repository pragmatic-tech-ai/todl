# Amazon Neptune

## Purpose

Managed graph database supporting Property Graph (Apache TinkerPop Gremlin) and RDF (SPARQL). Neptune Analytics adds vector search and graph analytics for AI grounding scenarios.

## Trade-offs

- Pick the query language first, not the engine. Gremlin
  (TinkerPop) and SPARQL (RDF) are fundamentally different
  abstractions; openCypher is supported but less mature on
  Neptune than on Neo4j. Wrong query-language choice forces a
  rewrite at production scale.
- vs. Neo4j AuraDB / TigerGraph Cloud / JanusGraph: Neo4j leads
  on Cypher tooling and ecosystem, TigerGraph on analytics
  performance, JanusGraph on multi-backend flexibility.
  Neptune wins on AWS-native VPC/IAM integration when the
  graph fits Gremlin or RDF cleanly.
- Performance varies enormously with query shape. Star-shaped
  ego queries are fast; deep traversals with property filters
  often need careful index design or end up scanning huge
  portions of the graph. Plan modelling time accordingly.
