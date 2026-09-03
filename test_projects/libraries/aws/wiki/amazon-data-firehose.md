# Amazon Data Firehose

## Purpose

Managed ingest pipeline for streaming data into S3, Redshift, OpenSearch, and Splunk. Auto-scales, batches, compresses, transforms, and encrypts before delivery.

## Trade-offs

- Buffer-based delivery has a floor: 60 seconds or 1 MB minimum,
  whichever hits first. End-to-end latency is buffered, not real-
  time — fine for analytics fan-in, wrong tool when a consumer
  needs sub-second freshness.
- Lambda-based transformation doubles the cost path and adds
  invocation latency. Heavy enrichment that wants near-line
  semantics ends up cheaper as a Kinesis Data Streams + KCL
  consumer than a Firehose transform Lambda chain.
- vs. Kinesis Data Streams: Firehose is "managed delivery to
  storage"; KDS is "I want to consume the stream". When the
  downstream is S3/Redshift/OpenSearch only, Firehose saves
  consumer infrastructure; when multiple consumers each want
  the stream, KDS is the right primitive.
