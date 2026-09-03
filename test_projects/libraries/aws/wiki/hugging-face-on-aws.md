# Hugging Face on AWS

## Purpose

Pre-integrated path for deploying and fine-tuning Hugging Face Transformer models on Amazon SageMaker. Compresses Hugging Face setup time from weeks to minutes.

## Trade-offs

- This is a partnership banner, not a service. The actual
  compute runs on SageMaker, Bedrock, or EC2. Architecture
  diagrams should reference the underlying compute service;
  "Hugging Face on AWS" is a marketing alias, not an
  independent runtime.
- HF Inference Endpoints (the HF-native managed product) is a
  separate path that bills directly to HF. Many teams confuse
  the two; verify whether spend flows through AWS or HF before
  modelling costs.
- vs. self-hosting HF models on SageMaker or EKS: the
  "pre-integrated" path is convenient for common transformer
  stacks but rarely tracks bleeding-edge model architectures.
  Cutting-edge work still requires custom containers and
  configurations.
