# Amazon Comprehend Medical

## Purpose

HIPAA-eligible NLP pre-trained on medical text. Extracts prescriptions, procedures, and diagnoses and maps them to ICD-10-CM, RxNorm, and SNOMED CT ontologies.

## Trade-offs

- HIPAA-eligible is not the same as "HIPAA-compliant by default".
  A BAA is required, the service must be deployed in eligible
  regions, and PHI handling on the consumer side is still the
  customer's responsibility.
- ICD-10-CM / RxNorm / SNOMED coverage is U.S.-clinical-leaning.
  Non-U.S. terminologies (ICD-10-AM, CIM-10, ATC drug codes) are
  not first-class — international healthcare workloads often pair
  Comprehend Medical with a translation/normalisation step.
- vs. dedicated clinical-NLP vendors (Linguamatics, Linguistic
  Insights, IQVIA): Comprehend Medical leads on ease-of-start
  and AWS-native integration; specialists lead on negation,
  uncertainty, temporal reasoning, and the long tail of clinical
  expression. High-stakes workflows often run both and reconcile.
