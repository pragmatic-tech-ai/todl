# Amazon DynamoDB

## Purpose

Key-value and document store with single-digit-millisecond latency at any scale. Multi-Region, with built-in backup, restore, and in-memory caching for internet-scale workloads.

## Trade-offs

- Access-pattern-first data modelling. DynamoDB rewards
  applications that know their queries in advance and pay
  the cost of restructuring the data (GSIs, denormalisation,
  composite keys) for those queries. Workloads that need
  ad-hoc joins or unconstrained query shapes belong on a
  relational engine.
- On-demand vs. provisioned capacity is a load-bearing choice.
  On-demand handles unpredictable workloads at higher unit cost;
  provisioned with auto-scaling is materially cheaper for
  predictable steady-state but punishes traffic spikes with
  throttling.
- vs. MongoDB / Cosmos DB / FoundationDB: DynamoDB's strong
  consistency, single-table design, and PartiQL surface are
  AWS-idiomatic but lock in. Multi-cloud or document-feature-
  heavy estates often prefer Atlas/Cosmos despite the AWS-
  native integration tax.
