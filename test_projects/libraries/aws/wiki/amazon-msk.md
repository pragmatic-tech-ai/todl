# Amazon Managed Streaming for Apache Kafka

## Purpose

Managed Apache Kafka clusters with high availability, encryption at rest, automatic node replacement, and a Kafka-native experience for streaming-data applications.

## Trade-offs

- MSK Serverless vs. provisioned is a real choice, not a flag.
  Serverless removes broker sizing and rebalancing but caps some
  Kafka features (no MirrorMaker, fewer protocol settings) and
  charges per partition-hour + per-GB; provisioned is cheaper at
  steady state and more flexible at the cost of operating it.
- "Managed" stops at the broker. Topic design, partitioning,
  consumer rebalance behaviour, and ACL strategy are still on the
  team. MSK gives you Kafka without the rack-and-stack — not
  without the Kafka mental model.
- vs. Kinesis Data Streams: pick MSK for Kafka API compatibility,
  the Kafka ecosystem (Connect, Streams, ksqlDB), or existing
  Kafka tooling. Pick KDS when "AWS-native, IAM-integrated, no
  cluster" is the priority and the producers/consumers can use
  the KCL/KPL.
