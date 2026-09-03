# Amazon Comprehend

## Purpose

NLP service that identifies language, extracts key phrases, places, people, brands, and events; analyses sentiment, tokens, and parts of speech; organises text by topic. AutoML adds custom entity recognition and classification.

## Trade-offs

- Pre-built classifiers are good at general English content;
  domain-specific terminology (legal, scientific, code-mixed
  language) often needs custom classifiers, and training those
  requires labelled corpora the team must produce.
- vs. Bedrock + a foundation model: an LLM prompted for the same
  NER/sentiment task usually beats Comprehend on flexibility and
  multi-language coverage, sometimes on quality. Comprehend wins
  on per-call cost and predictable latency for narrow,
  well-shaped tasks.
- Language coverage is real but uneven. Sentiment in 12 languages,
  entity recognition in fewer; check the support matrix per
  capability per language before committing a multilingual
  workload.
