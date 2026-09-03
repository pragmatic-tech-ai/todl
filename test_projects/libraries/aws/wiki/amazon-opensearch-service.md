# Amazon OpenSearch Service

## Purpose

Managed OpenSearch and Elasticsearch clusters for log analytics, full-text search, application monitoring, and clickstream analytics with enterprise-grade availability and security.

## Trade-offs

- Cluster sizing is a real operations problem. Shard counts,
  index lifecycle, JVM heap, and master-node sizing all need
  attention; the managed wrapper does not hide the underlying
  Elasticsearch/OpenSearch operational model from the team
  running it.
- Feature lag vs. upstream Elastic. Since the fork, Elastic's
  closed-license features (some advanced security, certain ML
  capabilities, newer query DSL pieces) are not available here.
  Workloads that depend on those specifically should evaluate
  Elastic Cloud rather than assume parity.
- vs. OpenSearch Serverless: provisioned wins on tight workload
  control and cost predictability at sustained scale; serverless
  wins on "spiky workload, don't want to think about capacity".
  The break-even shifts at roughly 4-6 OCUs of sustained load.
