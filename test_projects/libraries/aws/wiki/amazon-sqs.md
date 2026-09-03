# Amazon Simple Queue Service

## Purpose

Managed message queue for decoupling microservices and serverless workloads. Standard queues offer best-effort ordering with at-least-once delivery; FIFO queues offer exactly-once in-order delivery.

## Trade-offs

- "Exactly-once" on FIFO holds inside a 5-minute deduplication
  window. Real exactly-once still requires idempotent consumers;
  the FIFO guarantee is narrower than the marketing reads.
- Visibility-timeout tuning is load-bearing. Too short and parallel
  consumers pick the same message; too long and retries after a
  fast failure drag for minutes. It is the single most common
  source of mysterious queue-behaviour bugs.
- vs. Kafka / Kinesis: SQS is queue semantics — pull, ack, delete
  — at near-infinite scale. It is not a log: no replay, no
  consumer groups, no time-travel. Pick Kinesis or MSK when
  re-processing or multi-consumer fan-out from a stored offset
  matters.
