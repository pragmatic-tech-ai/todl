# AWS Trusted Advisor

## Purpose

Real-time guidance for cost, performance, security, and fault-tolerance improvements. Provisioning-best-practice checks across the AWS account.

## Trade-offs

- Useful but gated. Free tier exposes a small subset of checks;
  the full check set requires Business or Enterprise Support.
  Many of the cost-saving checks that justify the support tier
  live behind that paywall.
- Checks are advisory and broad-strokes. Trusted Advisor catches
  "you have an unattached EBS volume" and "you have idle ELBs";
  it does not catch architectural mistakes that drive real
  spend. Treat it as a hygiene tool, not a strategy tool.
- vs. CloudHealth / Densify / Compute Optimizer: dedicated FinOps
  tools find more, faster, with better remediation workflows.
  Trusted Advisor remains the convenient AWS-resident first
  pass.
