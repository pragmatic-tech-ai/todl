# AWS Key Management Service

## Purpose

Managed key management with HSM-backed key custody under the FIPS 140-2 Cryptographic Module Validation Program. Integrates with most AWS services for encryption at rest.

## Trade-offs

- Per-CMK monthly cost plus per-API-call cost. Heavy use
  (envelope encryption with frequent data-key generation) is
  often surprising on the bill. Caching the data keys is the
  standard optimisation.
- Key policies + IAM + grants compose into effective access in
  ways that are easy to misconfigure. The default "do not lock
  yourself out" guard catches the common cases but custom
  multi-account key policies regularly produce access surprises.
- vs. CloudHSM / external KMS: KMS is the right answer for
  99% of workloads. Reach for CloudHSM only when FIPS Level 3
  custody or PCI PIN-block-class requirements demand dedicated
  HSMs; reach for external KMS (HashiCorp Vault, etc.) when
  multi-cloud key escrow is the requirement.
