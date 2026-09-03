# AWS CloudHSM

## Purpose

Customer-controlled hardware security modules in AWS. FIPS 140-2 Level 3 validated for organisations that need dedicated HSM custody of cryptographic keys.

## Trade-offs

- Hourly per-HSM cost is steep — production deployments need
  multi-AZ clusters that scale the cost linearly. Use CloudHSM
  only when KMS doesn't meet the compliance bar.
- Operational burden is real. Crypto User and Crypto Officer
  account management, cluster initialisation, backup, and key
  recovery all sit with the customer. The "managed" label is
  thinner here than elsewhere.
- vs. KMS: KMS Custom Key Store can back KMS with CloudHSM,
  giving KMS's API ergonomics with HSM custody. For most
  workloads, plain KMS is enough; CloudHSM is justified by
  specific compliance requirements (PCI DSS PIN, FIPS 140-2
  Level 3 in regulated industries).
