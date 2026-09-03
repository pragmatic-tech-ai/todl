# AWS Certificate Manager

## Purpose

Managed SSL/TLS certificate provisioning and renewal. Includes AWS Private Certificate Authority for internal PKI without operating a CA stack.

## Trade-offs

- Public certs are free but only usable with AWS-integrated
  services (CloudFront, ALB, NLB, API Gateway). Workloads that
  need to install a cert on EC2 directly must pay for AWS
  Private CA or use Let's Encrypt.
- Renewal is automatic for ACM-issued certs in AWS-integrated
  services — and silent failures here are catastrophic. Set
  CloudWatch alarms on certificate expiry well before the
  renewal window.
- AWS Private CA is meaningfully expensive ($400/month per CA
  plus per-cert fees). For internal-only PKI at small scale,
  step-ca / smallstep or HashiCorp Vault PKI engine are far
  cheaper. AWS Private CA wins when integration with ACM,
  IoT Core, and IAM is required.
