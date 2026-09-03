# AWS Artifact

## Purpose

Self-service portal for AWS compliance artefacts — SOC, PCI, and accreditation reports across geographies and compliance verticals.

## Trade-offs

- Document repository, not an automation tool. Artifact gives
  auditors and compliance teams access to AWS's own reports;
  it does not produce your organisation's compliance evidence
  for the workloads you run on AWS. That's a separate problem
  for Audit Manager or third-party GRC.
- The Agreements section is operationally important: BAAs,
  GDPR DPAs, and similar are accepted through Artifact and
  bind the AWS account. Treat acceptance as a legal action
  with sign-off, not a checkbox.
- Use is essentially mandatory in regulated industries
  (healthcare, finance, government). Outside regulated work,
  Artifact's role is occasional reference, not daily tooling.
