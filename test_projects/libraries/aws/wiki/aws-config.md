# AWS Config

## Purpose

Resource inventory, configuration history, and change-notification service. AWS Config Rules continuously evaluate recorded resources against compliance policies.

## Trade-offs

- Per-recorded-configuration-item pricing scales with how much
  AWS-resource churn you produce. Estates with autoscaling
  groups, frequent Lambda redeployments, or short-lived
  resources produce surprising bills.
- Config Rules are powerful and operationally expensive.
  Managed rules are cheap and noisy; custom rules require
  Lambda functions you maintain. Enabling many rules without
  a remediation strategy creates a compliance backlog rather
  than improving posture.
- Underpins Security Hub, Audit Manager, Firewall Manager, and
  Control Tower drift detection. Disabling Config to save money
  breaks several downstream services — a frequent
  unintended-consequence finding.
