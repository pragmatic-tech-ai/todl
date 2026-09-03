# AWS Audit Manager

## Purpose

Continuous audit automation. Maps AWS resources to prebuilt frameworks (CIS, GDPR, PCI DSS) and gathers evidence for compliance reviews.

## Trade-offs

- Pre-built frameworks are starting points, not finished audits.
  Custom controls and evidence-collection rules for the
  organisation's actual risk posture take real work — the
  marketing suggests turnkey, the practice is iterative.
- AWS-only evidence. Cross-cloud or on-prem evidence remains
  manual or via third-party GRC. Hybrid estates often pair
  Audit Manager with Drata / Vanta / OneTrust for the wider
  audit story.
- vs. Drata / Vanta / Tugboat Logic: GRC vendors lead on the
  procedural side — evidence chasing, vendor management,
  employee policy attestation. Audit Manager wins on automated
  collection of AWS-resource configuration evidence.
