# Amazon GuardDuty

## Purpose

Threat-detection service over AWS accounts, workloads, EKS clusters, and S3. Combines integrated threat-intel feeds with ML anomaly detection.

## Trade-offs

- Should be on by default; the cost-to-value is one of the better
  ones in the AWS catalogue. The main risk is alert fatigue —
  without an SIR-triage runbook and a routing layer, the findings
  pile up and get ignored.
- Add-on protection plans (S3 Protection, EKS Audit Log
  Monitoring, Malware Protection, RDS Protection) each carry
  separate per-GB or per-volume pricing. Enabling them all
  blindly can multiply the bill; pick by which workloads
  actually matter.
- vs. Wiz / Lacework / Datadog Security: third-party CNAPP
  platforms cover multi-cloud, agent-based runtime signals, and
  posture management GuardDuty doesn't. GuardDuty wins on
  AWS-native depth and low setup overhead; CNAPPs win on
  breadth.
