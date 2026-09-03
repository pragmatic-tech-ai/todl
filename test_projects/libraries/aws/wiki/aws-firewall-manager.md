# AWS Firewall Manager

## Purpose

Centralised firewall-rule administration across accounts and applications in AWS Organizations. Enforces consistent security policy from a single console.

## Trade-offs

- Requires AWS Organizations + Config + delegated administration.
  Setup costs at the org level are non-trivial; small-org
  estates rarely justify it.
- Manages WAF, Shield, Network Firewall, security-group, and
  Route 53 Resolver DNS Firewall policies. The breadth is the
  value — and the configuration model is correspondingly large.
  Plan a tooling/IaC investment alongside.
- vs. per-account managed policies / Terraform org modules:
  Firewall Manager is the AWS-native answer when central
  policy ownership is the requirement. Terraform-based
  approaches give more flexibility but require the team to
  build the policy-drift detection loop themselves.
