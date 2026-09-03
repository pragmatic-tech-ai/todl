# Amazon Managed Service for Apache Flink

## Purpose

Managed runtime for Apache Flink streaming analytics. SQL or Java APIs over windowed data with built-in checkpointing and exactly-once semantics.

## Trade-offs

- Flink version is pinned per application and upgrades are
  disruptive: state snapshots may not migrate forward cleanly,
  and behaviour deltas between Flink minor versions are real.
  Pin the version and plan for a snapshot-and-restart upgrade
  path.
- Learning curve is non-trivial. Flink's state, checkpointing,
  and exactly-once mental model is more than most teams new to
  stream processing expect. Lambda + DynamoDB is far simpler for
  stateless or tiny-state stream work.
- vs. Spark Structured Streaming on EMR / Glue: Flink wins on
  true streaming semantics, sub-second latency, and event-time
  correctness. Spark is friendlier when the team already runs
  Spark batch and "streaming" really means "micro-batches every
  minute".
