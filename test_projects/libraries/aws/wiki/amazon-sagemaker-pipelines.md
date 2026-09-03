# Amazon SageMaker AI Pipelines

## Purpose

CI/CD for ML inside SageMaker. Authors, schedules, and operates end-to-end training and deployment pipelines as code.

## Trade-offs

- vs. Step Functions: Pipelines is ML-shaped (training, processing,
  evaluation, deployment steps with metadata) while Step Functions
  is general-purpose. Many teams end up using both — Pipelines for
  in-SageMaker work, Step Functions for the surrounding system
  orchestration.
- vs. open-source orchestrators (Airflow, Kubeflow, Metaflow):
  Pipelines is AWS-native and integrates tightly with the
  SageMaker registry and model card features. Open-source options
  win on portability across clouds and on stronger experiment-
  tracking ecosystems.
- Pipeline definitions are Python SDK on top of a JSON workflow
  model. Refactoring across SageMaker SDK versions occasionally
  requires non-trivial work; version-pin the SDK in build
  environments.
