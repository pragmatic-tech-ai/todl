# Amazon Timestream

## Purpose

Time-series database for IoT and operational telemetry. Stores trillions of events per day at a fraction of relational-engine cost and automates rollups, retention, tiering, and compression.

## Trade-offs

- Two flavours, separately priced. Timestream for LiveAnalytics
  (legacy) and Timestream for InfluxDB (newer, InfluxDB API)
  serve different access patterns. Mixing them up at design
  time leads to expensive re-platforming.
- Query language is its own dialect (LiveAnalytics) or InfluxQL/
  Flux (InfluxDB variant). SQL muscle memory does not transfer
  cleanly; expect a learning curve and BI-tool integration work.
- vs. InfluxDB Cloud / TimescaleDB / Prometheus + Cortex:
  specialist time-series vendors lead on query-language maturity
  and ecosystem; Timestream wins on AWS-native integration
  (IoT Core, Kinesis ingest, Grafana). Pick by where the
  upstream pipeline already lives.
