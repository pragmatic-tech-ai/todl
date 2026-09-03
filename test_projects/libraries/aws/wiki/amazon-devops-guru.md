# Amazon DevOps Guru

## Purpose

ML-powered observability that detects operational anomalies before they hit users. Summarises related anomalies, suggests likely root causes, and recommends remediation steps.

## Trade-offs

- Signal-to-noise is workload-dependent. On stable production
  systems with consistent traffic shapes, DevOps Guru surfaces
  real issues; on bursty or experimentation-heavy workloads it
  generates more noise than the SRE team has bandwidth to
  triage.
- Limited blast radius. Anomaly detection covers CloudWatch
  metrics and a few service-specific signals; it does not
  reason about application-level errors, business KPIs, or
  cross-service causality the way a mature SLO platform does.
- vs. Datadog Watchdog / New Relic AIOps: those tools cover
  multi-cloud and application-layer signals; DevOps Guru is
  AWS-only and infrastructure-centric. Choose by what the
  team needs to observe, not by AI sophistication.
