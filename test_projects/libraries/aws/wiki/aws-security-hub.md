# AWS Security Hub CSPM

## Purpose

Cloud security posture management aggregating findings from AWS services and partner products in a normalised format. Runs continuous best-practice checks against AWS resources.

## Trade-offs

- Aggregator, not investigator. Security Hub centralises
  findings from GuardDuty, Inspector, Macie, IAM Access Analyzer,
  and partner sources. Without a triage workflow and SOC
  ownership, findings accumulate as a backlog rather than
  driving action.
- Per-finding pricing + per-check pricing adds up quickly with
  organisation-wide coverage. Foundational Security Best Practices
  + CIS + PCI all enabled across many accounts produces a
  meaningful bill. Pick standards by actual obligation.
- vs. Wiz / Lacework / Prisma Cloud: third-party CSPMs lead on
  multi-cloud reach, attack-path analysis, and workload-runtime
  signals. Security Hub wins on AWS-native depth and tight
  integration with AWS-native security services.
