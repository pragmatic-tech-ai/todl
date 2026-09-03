# Amazon Simple Notification Service

## Purpose

Managed pub/sub messaging with topics for many-to-many fan-out plus direct delivery to email, SMS, mobile push, and SQS subscribers. Decouples producers from consumers.

## Trade-offs

- Pure fan-out with no consumer-side buffering. Subscribers that
  go down lose messages unless the topic feeds an SQS queue
  (the SNS-to-SQS pattern). Direct Lambda or HTTP subscribers
  without a queue between is the most common SNS footgun.
- FIFO topics solve ordering but cap each message group at
  300 messages/second. Genuine high-throughput ordered streams
  belong on Kinesis or MSK, not on FIFO topics being asked to
  hold a lane open.
- vs. EventBridge: SNS is simpler and cheaper for plain
  pub/sub. EventBridge wins only when content-based filtering,
  schemas, or SaaS-source ingestion are actually used. Reaching
  for the bus for fan-out alone is overbuild.
