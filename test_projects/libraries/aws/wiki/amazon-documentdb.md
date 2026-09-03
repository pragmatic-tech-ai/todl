# Amazon DocumentDB

## Purpose

MongoDB-API-compatible managed document database. Emulates MongoDB 3.6 and 4.0 wire-protocol responses so existing drivers and tools continue to work.

## Trade-offs

- Wire-compatible with old MongoDB versions (3.6 / 4.0), not
  modern ones. Applications using current MongoDB features
  (transactions on sharded clusters, time-series collections,
  newer aggregation pipeline operators, $vectorSearch) will hit
  walls.
- Built on Aurora-style storage, not the MongoDB server.
  Operational characteristics (replication, failover, IOPS
  pricing) follow Aurora — not MongoDB Atlas. Performance tuning
  knowledge from Atlas transfers partially at best.
- vs. MongoDB Atlas / self-hosted MongoDB: Atlas leads on
  feature currency, multi-cloud reach, and Realm/Atlas Search.
  DocumentDB wins when "stay on AWS, IAM-integrated, VPC-native"
  matters more than feature parity with modern MongoDB.
