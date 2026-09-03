# Amazon SageMaker AI Edge

## Purpose

Optimisation and deployment path for shipping SageMaker-trained models to edge devices such as smart cameras and robots. Monitors deployed fleet performance and drift.

## Trade-offs

- SageMaker Edge Manager is being deprecated. AWS recommends
  Greengrass + SageMaker Neo for new edge-inference workloads;
  Edge Manager's device-fleet management features are
  effectively in maintenance.
- Fleet management at edge is genuinely hard regardless of tool.
  Model rollout, A/B comparison, on-device drift detection, and
  rollback over flaky networks need infrastructure beyond what
  Edge Manager provided — most production teams build glue.
- vs. Greengrass + Neo / Azure IoT Edge ML / NVIDIA Fleet Command:
  Greengrass is the AWS-forward path; Azure and NVIDIA lead in
  their respective hardware ecosystems. Pick by hardware and
  network topology, not by AWS-branding.
