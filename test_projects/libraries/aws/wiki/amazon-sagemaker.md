# Amazon SageMaker AI

## Purpose

End-to-end ML lifecycle platform. Build, train, tune, deploy, and monitor models from a single workbench with fully managed infrastructure, tools, and workflows.

## Trade-offs

- "SageMaker" is a constellation, not a service. Studio, Training,
  Inference, Pipelines, Feature Store, JumpStart, HyperPod, Canvas
  — each is its own product with its own pricing model and
  operational shape. Treating "SageMaker" as monolithic is the
  most common architecture mistake.
- Each managed component carries overhead vs. raw EC2 + your own
  scripts: storage, network charges, and the per-instance markup
  for SageMaker-flavoured AMIs. The convenience is real, the
  cost is too.
- vs. Databricks / Vertex AI / self-hosted ML platforms: SageMaker
  wins on AWS-native integration and breadth; Databricks leads on
  notebook collaboration and lakehouse integration; Vertex on
  Google's TPU and Gemini access. Choose the platform first, then
  the components within it.
