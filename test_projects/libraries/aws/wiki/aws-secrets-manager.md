# AWS Secrets Manager

## Purpose

Managed lifecycle for database credentials, API keys, and other secrets. Built-in rotation hooks for RDS, Redshift, and DocumentDB.

## Trade-offs

- Per-secret monthly + per-API-call pricing. Estates with
  hundreds of small secrets (config flags, feature toggles) are
  often cheaper on Systems Manager Parameter Store. Use Secrets
  Manager for the rotatable, security-sensitive things; use
  Parameter Store for everything else.
- Rotation hooks for non-AWS databases or custom credentials
  require writing the rotation Lambda yourself. The "automatic
  rotation" marketing only covers the built-in AWS-database
  types out of the box.
- vs. HashiCorp Vault / SOPS / Doppler: Vault leads on
  cross-cloud, dynamic credentials, and PKI integration; SOPS
  on Git-resident secrets workflows. Secrets Manager wins on
  AWS-native simplicity and IAM-resolved access.
