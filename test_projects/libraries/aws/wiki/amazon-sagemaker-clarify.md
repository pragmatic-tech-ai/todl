# Amazon SageMaker AI Clarify

## Purpose

Bias-detection and model-explainability feature inside SageMaker. Surfaces bias during data prep, after training, and in deployed inference traffic.

## Trade-offs

- SHAP-based explanations are real but expensive. On large
  datasets or high-cardinality features, Clarify jobs can run
  for hours and cost meaningfully. Sampling strategies are
  load-bearing for production use.
- Bias metrics are statistical, not normative. Clarify reports
  disparate-impact ratios and similar numbers; deciding what's
  acceptable, what's a protected class, and what mitigation
  looks like is still the responsibility of the data-science
  and legal teams.
- Coverage is tabular and image. NLP fairness (toxicity, gender
  bias in embeddings, fairness in LLM responses) is largely
  out of scope — bring a specialist tool (HuggingFace Evaluate,
  Aequitas, custom audits) for those modalities.
