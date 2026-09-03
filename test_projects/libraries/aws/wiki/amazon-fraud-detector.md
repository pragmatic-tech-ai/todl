# Amazon Fraud Detector

## Purpose

Managed ML for fraud detection. Automates training and deployment of fraud-detection models, drawing on 20+ years of Amazon's own anti-fraud experience.

## Trade-offs

- Quality of the resulting model depends on quality of the
  labelled history. Cold-start fraud detection — no historical
  labelled data — is exactly where the service struggles most;
  feature engineering and rule-only models often outperform it
  for new business lines.
- vs. Sift / Forter / Riskified / SEON: incumbent fraud vendors
  bring shared-network signal across many merchants (IP
  reputation, device fingerprinting, behavioural patterns) that
  Fraud Detector does not match. Self-contained merchants with
  rich history can do well; merchants without network signal
  rarely beat shared-graph approaches.
- Per-prediction pricing competes only at modest volumes. High-
  TPS e-commerce or banking workloads often pay back the cost
  of running their own gradient-boosting pipeline on SageMaker
  within a quarter.
