# Amazon Kinesis Data Streams

## Purpose

Durable, append-only event log capturing gigabytes per second from clickstreams, change data capture, financial transactions, and application logs. Consumers replay or tail the stream.

## Trade-offs

- Provisioned mode requires shard math: 1 MB/s write, 2 MB/s read
  per shard. Under-provisioning throttles; over-provisioning pays
  for idle shards. On-demand mode removes the math at higher unit
  cost and a lag while it auto-scales.
- Default retention is 24 hours, up to 365 days. Long retention
  is a real cost item — for true unbounded archiving, Firehose
  to S3 is cheaper than paying KDS to be a cold archive.
- vs. MSK / Kafka: KDS is the right pick when "AWS-native, no
  cluster to operate, IAM-integrated" is the priority. MSK wins
  when the team needs full Kafka API compatibility, consumer
  groups outside KCL, or the Kafka ecosystem (Kafka Connect,
  ksqlDB).
