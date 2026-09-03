# AWS CodeDeploy

## Purpose

Automates application deployments to EC2 instances, on-premises servers, Lambda functions, and ECS services. Handles fleet-wide rollout patterns without downtime.

## Trade-offs

- Three deployment targets (EC2/on-prem, Lambda, ECS), three
  distinct behaviour models. EC2 in-place vs. blue/green vs.
  Lambda traffic shifting vs. ECS blue/green each have their
  own knobs and failure modes; don't assume what you know about
  one transfers.
- AppSpec hooks are powerful and easy to make brittle. Lifecycle
  events that depend on instance state or external services
  fail in ways that block rollouts; defensive hook scripting
  is real engineering work.
- vs. Spinnaker / Argo CD / native ECS/EKS rolling deploys:
  GitOps tools (Argo, Flux) win for Kubernetes; ECS rolling
  deploy is simpler than CodeDeploy for ECS unless blue/green
  is required. CodeDeploy survives in EC2-heavy estates and
  CodePipeline-anchored pipelines.
