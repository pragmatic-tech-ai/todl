# Red Hat OpenShift Service on AWS

## Purpose

Jointly-supported OpenShift on AWS. Uses familiar OpenShift APIs and tools, billed hourly or annually with a 99.95% SLA and combined AWS + Red Hat support.

## Trade-offs

- Pays for OpenShift on top of AWS infrastructure. ROSA is
  meaningfully more expensive than EKS for the same node fleet;
  the premium buys the OpenShift developer experience, native
  CI/CD primitives, and Red Hat support.
- Justified when teams have OpenShift expertise or rely on
  OpenShift-specific features (BuildConfigs, Routes, OperatorHub
  catalogues, Tekton pipelines pre-wired). Greenfield workloads
  with no OpenShift history rarely pick ROSA over EKS.
- vs. EKS / self-managed OpenShift on EC2: ROSA wins on operations
  burden (no control-plane management) vs. self-managed; loses
  on price vs. EKS. The middle position is rarely cost-optimal,
  it's chosen for ecosystem reasons.
