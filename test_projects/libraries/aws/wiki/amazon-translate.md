# Amazon Translate

## Purpose

Neural machine translation across many language pairs. Deep-learning quality replacing older statistical and rule-based translators.

## Trade-offs

- vs. DeepL / Google Translate / GPT-4 family for translation:
  DeepL leads on European-language quality (especially nuance
  and register); GPT-4 / Claude-class LLMs lead on style control
  and long-context coherence. Amazon Translate is fast, cheap,
  and competitive in many pairs but is rarely the quality
  ceiling.
- Custom terminology and parallel-data training (Active Custom
  Translation) help significantly on domain-specific corpora —
  legal, technical, product catalogues — and are the
  differentiator when content matters more than benchmark
  scores.
- Per-character pricing favours high-volume, latency-tolerant
  bulk translation. Interactive UX with very large per-request
  payloads pays the price; chunking strategies matter for
  perceived latency.
