# AWS X-Ray

## Purpose

Distributed tracing for microservices. End-to-end view of request flow plus a map of underlying components for performance and reliability debugging.

## Trade-offs

- AWS-native distributed tracing competes with OpenTelemetry-
  based stacks. X-Ray works well within AWS service boundaries
  but lags on cross-cloud, on-prem, or third-party tracing
  surface area. New work should consider OpenTelemetry + a
  vendor-agnostic backend.
- Sampling defaults are conservative. The first reservoir (1
  request/sec) plus a fixed rate is what most teams hit;
  custom sampling rules unlock the real value but require
  thinking about which traces matter most.
- vs. Datadog APM / Honeycomb / New Relic / Lightstep: dedicated
  tracing platforms lead on cardinality, query power, and
  cross-system correlation. X-Ray wins on AWS-native simplicity
  and per-request pricing for AWS-only stacks.
