# Amazon Augmented AI

## Purpose

Workflow orchestration for human-in-the-loop ML review. Removes the heavy lifting of recruiting reviewers, distributing tasks, and aggregating annotations across labelling and content-moderation pipelines.

## Trade-offs

- Human review workflows are AWS-built but the reviewers still
  come from somewhere — a private workforce, a vendor, or
  Mechanical Turk. A2I supplies the workflow plumbing; sourcing,
  training, and QA of reviewers remain on the team.
- vs. SageMaker Ground Truth: A2I is for ongoing prediction review
  (catching low-confidence inferences in production), Ground
  Truth is for labelling training data up front. They look similar
  but solve different problems; conflating them is a frequent
  design error.
- Integrates cleanly with Rekognition, Textract, and SageMaker
  endpoints; non-AWS models need custom endpoint wiring. For a
  mixed-vendor ML estate, that AWS-only integration depth
  becomes a constraint, not a feature.
