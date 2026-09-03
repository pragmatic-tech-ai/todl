# Amazon SageMaker AI Feature Store

## Purpose

Purpose-built repository for ML feature reuse across training and inference. Eliminates feature drift between offline and online pipelines and standardises naming across teams.

## Trade-offs

- Offline + online dual storage means double pay for the same
  feature. The architectural value (training/serving consistency)
  is real, but the bill scales with feature breadth and
  retention.
- Online store latency caps and TPS limits matter at production
  scale. Heavy online traffic patterns occasionally outrun the
  managed online store and force a custom DynamoDB or ElastiCache
  layer in front — at which point the value of the managed
  store drops.
- vs. Tecton / Hopsworks / Feast (open source): Tecton and
  Hopsworks lead on feature engineering workflows and multi-cloud;
  Feast is the open-source primitive that gives full control.
  SageMaker Feature Store wins on AWS-native simplicity but
  trails on workflow polish.
