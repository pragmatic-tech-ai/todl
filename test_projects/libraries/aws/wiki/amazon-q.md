# Amazon Q

## Purpose

Umbrella GenAI assistant brand. Comprises Amazon Q Business (knowledge assistant grounded in enterprise data) and Amazon Q Developer (coding and IT assistant).

## Trade-offs

- Umbrella label, not a single product. Q Business (enterprise
  RAG assistant) and Q Developer (coding assistant) ship under
  this brand but are operationally and contractually distinct.
  Architecture choices target the specific Q product, not the
  family.
- Pricing, IdP integration, region availability, and data-
  residency posture differ between the Q variants. Treat each
  as its own service for compliance review.
- See [`amazon-q-business`](amazon-q-business.md),
  [`amazon-q-developer`](amazon-q-developer.md), and
  [`amazon-q-chat`](amazon-q-chat.md) for variant-specific
  trade-offs.
