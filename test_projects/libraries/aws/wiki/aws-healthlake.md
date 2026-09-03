# AWS HealthLake

## Purpose

HIPAA-eligible store for healthcare data with integrated medical NLP. Lets providers, payers, and pharma organisations query, transform, and analyse FHIR-formatted records at scale.

## Trade-offs

- FHIR R4 only and AWS-region constrained. Healthcare estates
  that still produce HL7 v2 (most U.S. EHR integrations) need a
  conversion layer in front; HealthLake does not absorb that
  problem.
- Per-GB-stored + per-API-call pricing escalates with rich
  longitudinal records. Datasets that look modest in document
  count can be expensive in stored size after FHIR resource
  expansion. Model retention before commitment.
- vs. Microsoft FHIR Service / Google Healthcare API: feature
  parity is close. Differentiation is ecosystem: HealthLake
  pairs with Comprehend Medical and SageMaker; Microsoft and
  Google integrate with their own analytics + AI stacks. Pick
  by where the rest of the platform lives.
