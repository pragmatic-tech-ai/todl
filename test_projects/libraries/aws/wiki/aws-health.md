# AWS Health

## Purpose

Personalised service-health feed plus remediation guidance. Surfaces events that affect customer-owned AWS resources and announces scheduled platform activities.

## Trade-offs

- Personal Health Dashboard is the right signal source; the
  public status page often lags. Wire Health events to
  EventBridge → PagerDuty / Opsgenie / Slack early.
- Health API access is gated to Business and Enterprise Support
  plans. Lower support tiers see the console but cannot
  programmatically integrate — limiting automation options.
- Events vary widely in actionability. Some demand same-day
  response (planned EC2 retirement), others are informational
  (new region launches). Filtering before routing is essential
  to avoid alert fatigue.
