# AWS IAM Identity Center

## Purpose

Cloud SSO across AWS accounts and SaaS applications. Built-in SAML connectors for Salesforce, Box, Microsoft 365, plus any SAML 2.0 application.

## Trade-offs

- Region-pinned. The Identity Center instance lives in one
  region; choose carefully, because migrating is a re-setup
  and breaks all permission-set assignments. Region selection
  is a one-time architectural decision.
- vs. Okta / Entra ID as primary IdP: Identity Center can act
  as IdP or proxy to one. For AWS-only estates, native is
  simpler; for organisations standardised on Entra ID or Okta,
  Identity Center as a proxy with permission-set management
  is the common pattern.
- The path forward for AWS console access — AWS Single Sign-On
  was renamed to it, and legacy IAM users-with-passwords for
  human access are now strongly discouraged. New AWS accounts
  should set up Identity Center on day one.
