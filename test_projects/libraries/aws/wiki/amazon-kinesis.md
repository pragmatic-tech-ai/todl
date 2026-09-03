# Amazon Kinesis

## Purpose

Umbrella for AWS real-time streaming data services: Firehose, Managed Service for Apache Flink, Kinesis Data Streams, and Kinesis Video Streams.

## Trade-offs

- This is an umbrella label, not a service. Don't model
  applications against "Kinesis" — pick a specific component:
  Data Streams for log-shaped streams, Firehose for managed
  delivery to storage, Managed Flink for stateful stream
  processing, Video Streams for media.
- The four products under the umbrella have distinct pricing
  models, scaling units, and integration patterns. Treating them
  as interchangeable is the most common architecture mistake;
  they share a brand, not a runtime.
- See the specific entries for component-level trade-offs.
