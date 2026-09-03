# Amazon Cognito

## Purpose

Identity service for application sign-up, sign-in, and access control. Federates with social IdPs, SAML 2.0 providers, and bring-your-own identity systems; scales to millions of users.

## Trade-offs

- Two distinct services share the brand. User Pools (identity)
  and Identity Pools (federated AWS-resource access) solve
  different problems; many architectures need both but the
  configuration surface is large and not well-bridged.
- Customisation cliffs are real. Lambda triggers cover most
  flows but custom MFA flows, advanced password policies, and
  certain B2B SaaS patterns hit hard ceilings — at which point
  teams either replatform onto Auth0/Okta/Keycloak or build
  bespoke flows on top.
- vs. Auth0 / Okta CIC / Firebase Auth: Cognito wins on price
  for high-volume consumer apps and on AWS-native IAM
  integration. Specialised IdPs lead on developer experience,
  passwordless and OIDC nuance, and B2B-tenant management.
