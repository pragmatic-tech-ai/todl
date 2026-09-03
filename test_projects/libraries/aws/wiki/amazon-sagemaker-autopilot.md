# Amazon SageMaker AI Autopilot

## Purpose

AutoML feature inside SageMaker. Provide a tabular dataset and target column; Autopilot explores feature engineering and candidate models to find the best fit.

## Trade-offs

- AutoML is good at finding a competent baseline, not a great
  final model. Hand-tuned gradient-boosting with domain feature
  engineering still beats Autopilot on most serious tabular
  problems; the gap is "good enough for a POC" vs. "production
  win".
- Training cost is meaningful — Autopilot explores tens of model
  candidates with full hyperparameter sweeps. Repeating runs on
  refresh schedules can outrun the value when an offline model
  rarely changes meaningfully.
- vs. SageMaker Canvas: Canvas is the UI for the same engine
  aimed at analysts; Autopilot is the API/notebook flavour for
  engineers. Pick based on who owns the model lifecycle, not
  on algorithmic capability.
