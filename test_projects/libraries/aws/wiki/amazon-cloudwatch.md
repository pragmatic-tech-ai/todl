# Amazon CloudWatch

## Purpose

Logs, metrics, and events for AWS resources, hybrid workloads, and on-premises servers. Unified observability foundation for ops teams and SREs.

## Trade-offs

- Log ingestion + storage pricing dominates the bill. Verbose
  application logs at full retention can be the single largest
  line item — log-level discipline, tiered retention, and
  exports to S3 are load-bearing for cost control.
- Logs Insights query power lags purpose-built log tools.
  Complex aggregations and joins across log groups are awkward
  compared to Splunk SPL or Datadog log queries; teams that
  expect a full SIEM-class experience are disappointed.
- vs. Datadog / New Relic / Grafana Cloud / Splunk: dedicated
  observability vendors lead on UX, integrations, and APM
  features. CloudWatch wins on AWS-native depth (every service
  publishes here) and unified billing. Most serious estates
  run CloudWatch alongside a specialist, not instead of one.
