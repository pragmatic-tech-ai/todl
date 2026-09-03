# AWS Control Tower

## Purpose

Landing-zone automation for multi-account AWS environments. Configures management and security services to AWS-recommended baselines.

## Trade-offs

- Opinionated landing zone. The controls and account
  structure Control Tower establishes are AWS's recommendation
  — modifying them later is fenced. Start with Control Tower
  early or commit to retrofitting; mid-migration adoption is
  painful.
- Once enabled, drift detection and remediation become an
  ongoing operations stream. Teams that adopt Control Tower
  without an account-ops function find the dashboard accumulating
  drift findings nobody owns.
- vs. building a landing zone with org / Config / IaC: rolling
  your own gives full flexibility but requires real platform-
  team commitment. Control Tower is the right starting point
  for most multi-account estates; large platform teams may
  outgrow it.
