# AWS HealthScribe

## Purpose

HIPAA-eligible clinical-note generator. Combines speech recognition and GenAI to draft clinical documentation from patient-clinician conversations for downstream EMR ingest.

## Trade-offs

- Drafts notes, does not finalise them. Clinical liability stays
  with the clinician; HealthScribe outputs always require human
  review. The marketing emphasises automation; production
  workflows emphasise verification.
- vs. Nuance DAX / Suki / Abridge: incumbent clinical-scribe
  vendors have years of clinician-feedback tuning, deep EMR
  integrations (Epic, Cerner), and large customer-evidence
  bases. HealthScribe is newer and shallower on EMR-side
  integration.
- HIPAA-eligible is necessary but not sufficient. Workflow
  integration (consent capture, ambient capture quality on
  exam-room hardware, EMR write-back) drives whether
  HealthScribe lands well — the model quality is rarely the
  bottleneck.
