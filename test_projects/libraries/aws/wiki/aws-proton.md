# AWS Proton

## Purpose

Managed delivery service for container and serverless applications. Lets platform engineering teams template provisioning, deployments, monitoring, and updates as a self-service product.

## Trade-offs

- Effectively dormant. AWS investment in Proton has slowed
  significantly; the platform-engineering ecosystem has
  centred on Backstage and Crossplane. Greenfield IDP work
  rarely targets Proton.
- Template authoring is more complex than the marketing
  suggests. Schema design, versioning, and the dual-template
  model (environment + service) require substantial up-front
  investment from the platform team.
- vs. Backstage + Crossplane / Humanitec / Port: dedicated IDP
  platforms lead on developer experience and ecosystem reach.
  Proton's main remaining niche is AWS-only estates that
  refused open-source platform tools.
