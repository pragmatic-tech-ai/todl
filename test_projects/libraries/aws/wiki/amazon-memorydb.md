# Amazon MemoryDB

## Purpose

Redis-compatible durable in-memory database. Persists data across multiple AZs via a distributed transactional log, giving cache-tier latency with disk-tier durability.

## Trade-offs

- Pays the cost of durability. MemoryDB is meaningfully more
  expensive than ElastiCache for the same memory footprint, in
  exchange for multi-AZ transaction-log durability. Use it
  only when the Redis store IS the source of truth.
- vs. ElastiCache: choose MemoryDB when "lose the cache, lose
  the data" is unacceptable; ElastiCache when cache loss is a
  cold-start, not a data-loss event. Mixing them up either
  overspends on durability or underspends on safety.
- vs. DynamoDB: MemoryDB has Redis-API familiarity and complex
  data types (sorted sets, streams, geospatial). DynamoDB has
  larger items, better cost at huge scale, and TTL/streams
  patterns. Pick by data model needs, not by latency claims.
