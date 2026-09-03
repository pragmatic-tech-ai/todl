# AWS Cost Explorer

## Purpose

Interactive UI for visualising AWS cost and usage over time. Creates custom reports at high level or for highly-specific queries.

## Trade-offs

- 12-month lookback by default; longer requires explicit
  enabling and accumulates from that point forward, not
  retroactively. New AWS accounts have limited useful history
  regardless of the setting.
- Console UX is fine for ad-hoc analysis; programmatic access
  via the Cost Explorer API costs per request and is rate-
  limited. High-frequency automated cost queries belong on
  CUR-via-Athena, not Cost Explorer API.
- Anomaly Detection (now under Cost Explorer) and Forecast are
  useful baseline-level tools. Sophisticated FinOps work moves
  off them to dedicated platforms; small-medium estates often
  stop here.
