# Amazon SageMaker AI JumpStart

## Purpose

Solution and model catalog inside SageMaker. One-click deployment and fine-tuning of 150+ popular open-source models for common ML use cases.

## Trade-offs

- "One-click deploy" is true; "one-click maintain" is not.
  JumpStart-deployed models still need monitoring, scaling, cost
  control, and version management like any other SageMaker
  endpoint.
- Model catalogue lag. Open-source frontier models often arrive
  on Hugging Face weeks before they reach JumpStart's curated
  list. Cutting-edge work usually pulls from HF directly; the
  catalogue serves teams that want a vetted, pre-tested choice.
- Fine-tuning workflows are wrappers around the underlying
  SageMaker Training APIs. Convenient for stock recipes; for
  novel fine-tuning approaches (LoRA variants, custom data
  preprocessing) you end up in SageMaker Training directly.
