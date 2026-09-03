# Amazon Keyspaces

## Purpose

Serverless Apache-Cassandra-compatible database. Run existing Cassandra code and tools against an AWS-managed, auto-scaling backend with pay-per-use billing.

## Trade-offs

- CQL compatibility is partial. Some operators, lightweight
  transactions, and admin commands differ from open-source
  Cassandra. Production cutovers from self-managed Cassandra
  require careful testing — "drop-in compatible" is overstated
  in the marketing.
- Pricing per million RWUs/WCUs makes high-throughput Cassandra
  workloads expensive vs. running Cassandra on EC2 with reserved
  instances. Keyspaces wins on operations savings, not on raw
  storage/throughput economics at scale.
- vs. ScyllaDB Cloud / DataStax Astra / self-hosted Cassandra:
  specialised vendors lead on Cassandra-feature completeness
  and migration tooling; Keyspaces wins on AWS-native IAM,
  VPC, and CloudWatch integration. Pick by Cassandra-knowledge
  depth in the team.
