# Amazon Rekognition

## Purpose

Managed image and video analysis. Identifies objects, scenes, text, people, and activities; performs facial analysis and search; Custom Labels supports domain-specific classification.

## Trade-offs

- Face-comparison capabilities sit on real regulatory and
  reputational risk. AWS has gated and unwound parts of this
  feature historically; deployments that use facial analysis at
  scale need a clear governance review beyond the technical
  integration.
- Per-image / per-second pricing competes well with running
  custom models on SageMaker only for narrow, well-shaped tasks
  (label detection, content moderation). High-volume custom-
  classification workloads usually run cheaper on a SageMaker
  endpoint after the first few months.
- Custom Labels is convenient but trains on small datasets and
  reflects that — you'll outgrow it once accuracy targets get
  serious. Plan a migration path to SageMaker (with the same
  training data) before deep-coupling to Custom Labels.
