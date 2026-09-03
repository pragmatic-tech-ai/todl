# AWS AppFabric

## Purpose

Aggregates and normalises SaaS-application security data using OCSF. Connects many SaaS apps for cross-tool observability and security without bespoke connector code.

## Trade-offs

- Connector coverage drives the value. AppFabric works for the
  SaaS apps it has connectors for; outside that list (and the
  list updates slowly), the team is back to bespoke
  integrations. Verify per-SaaS coverage before commitment.
- Targeted at security teams primarily. As a generic SaaS-data
  unification layer it's narrower than vendors built for that
  purpose. Treat as a security-log aggregator with productivity
  data on the side.
- vs. Workato / Tray.io / iPaaS vendors / Glean for productivity
  / Splunk SOAR for security: dedicated iPaaS and SIEM-SOAR
  vendors lead on coverage and workflow features. AppFabric
  wins when AWS-resident security telemetry from SaaS apps is
  the specific goal.
