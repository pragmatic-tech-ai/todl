# Amazon Macie

## Purpose

Data-classification and data-loss-prevention service for S3. Uses ML and pattern matching to surface PHI, PII, financial data, and custom-defined sensitive types.

## Trade-offs

- Per-GB-scanned pricing escalates fast at petabyte scale.
  Continuous scans of full data lakes can rival the storage
  bill. Use sampling, scope to high-risk buckets, and schedule
  scans rather than running them constantly.
- S3-only. Sensitive data in RDS, EBS, EFS, or non-AWS stores
  is invisible to Macie. Treat as one data-discovery tool in
  a portfolio, not as a comprehensive DLP solution.
- vs. BigID / Varonis / Microsoft Purview: dedicated data-
  classification vendors lead on cross-store coverage, fine-
  grained policy engines, and remediation workflows. Macie
  wins on AWS-native simplicity for S3-resident sensitive data.
