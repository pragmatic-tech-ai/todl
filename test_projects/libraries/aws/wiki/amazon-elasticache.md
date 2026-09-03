# Amazon ElastiCache

## Purpose

Managed in-memory cache supporting Redis OSS and Memcached. ElastiCache Serverless removes capacity-planning for spiky workloads.

## Trade-offs

- Engine choice has long-term consequences. The Redis-licensing
  split moved AWS to "Redis OSS" with its own fork (Valkey-
  adjacent) and parallel feature roadmap. Pinning to
  ElastiCache for Redis ties the team to AWS's fork rather than
  upstream Redis Inc.'s.
- Serverless removes capacity planning at a higher per-op cost.
  Always-warm production caches usually cost less on provisioned
  with reserved nodes; intermittent caches benefit from
  Serverless. Crossing point shifts at ~25-40% utilisation.
- vs. MemoryDB: ElastiCache trades durability for cache-grade
  latency. MemoryDB is the Redis API with multi-AZ durable
  storage. Use ElastiCache where data loss in the cache is fine,
  MemoryDB when the Redis store IS the source of truth.
