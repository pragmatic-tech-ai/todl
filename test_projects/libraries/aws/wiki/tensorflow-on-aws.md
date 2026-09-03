# TensorFlow on AWS

## Purpose

AWS-supported distribution of the TensorFlow framework with broad integrations for CV, NLP, speech, and translation workloads across SageMaker, EC2, and containers.

## Trade-offs

- Same partnership-banner caveat as PyTorch on AWS: not a
  runtime, just TensorFlow + an AWS compute target. Diagrams
  should reference the compute service.
- TensorFlow's share of new ML work has fallen sharply in
  favour of PyTorch; production estates often inherit
  TensorFlow code rather than start with it. Plan for a future
  migration if the architecture is fresh today.
- TensorFlow Serving and TF-on-Lambda are mature integration
  points, useful for legacy estates. New deployments more
  commonly use SageMaker model endpoints or BYO containers
  regardless of framework choice.
