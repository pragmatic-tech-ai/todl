# Amazon Bedrock

## Purpose

Managed foundation-model API surface offering models from AI21, Anthropic, Cohere, DeepSeek, Luma, Meta, Mistral, Stability AI, and Amazon's own Nova family — accessed through a single AWS-native endpoint.

## Trade-offs

- Per-region model availability is uneven. Not every model is in
  every region, and quota for top-tier models (Anthropic Claude
  Opus, Llama 3 70B) is gated. Multi-region production designs
  must plan for the matrix, not assume any region has any model.
- vs. direct provider APIs (Anthropic, OpenAI, Cohere directly):
  Bedrock wins on IAM-native auth, PrivateLink, AWS-billed spend,
  and CloudTrail audit. It can lag the provider's own API on the
  newest features and model variants by weeks. Cutting-edge work
  often runs against the source API; production runs against
  Bedrock.
- Provisioned-throughput pricing is a real lever — and a real
  trap. It commits to a model version, so an upstream model
  upgrade forces re-purchasing capacity. Use on-demand until the
  workload's traffic shape and model choice are stable.
