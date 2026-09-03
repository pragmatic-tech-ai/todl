# Amazon Managed Grafana

## Purpose

Managed Grafana dashboards correlating metrics, logs, and traces from AWS and third-party data sources. Built-in AWS data source connectors.

## Trade-offs

- Per-active-user pricing. Wide-read dashboards with many
  viewers cost meaningfully more than a self-hosted Grafana
  EC2 instance. Crossover happens fast — at maybe 20-50 active
  users, self-hosting saves money for the same SLO.
- Grafana Enterprise plugins are extra. Many of the visual or
  integration features the team expects (Splunk plugin,
  Dynatrace plugin, certain Datadog features) sit behind the
  Enterprise tier.
- vs. self-managed Grafana / Grafana Cloud: self-managed is
  cheapest if you have the ops capacity. Grafana Cloud
  (Grafana Labs SaaS) sometimes leads on plugin freshness and
  multi-cloud features. Managed Grafana wins when AWS-native
  SSO and audit are required.
