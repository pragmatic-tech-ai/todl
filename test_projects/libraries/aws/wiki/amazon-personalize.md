# Amazon Personalize

## Purpose

Managed recommendation engine derived from Amazon.com's own systems. Offers retail- and media-tuned recommenders and intelligent user segmentation without bespoke ML pipelines.

## Trade-offs

- Cold-start is real. Personalize needs interaction history
  (recommended minimum tens of thousands of interactions per
  recipe) before it produces useful rankings. New-product or
  new-domain launches lean on metadata-based fallbacks for
  the first weeks.
- Recipes are opinionated. The HRNN, USER_PERSONALIZATION, and
  similar recipes work well within their assumed shape; ranking
  problems that need real-time features, multi-armed bandits, or
  cross-domain transfer often fit SageMaker custom models better.
- vs. recsys vendors (Algolia, Constructor, Coveo) and in-house
  on SageMaker: Personalize is faster to ship than in-house but
  less customisable than vendors that specialise in retail or
  media UX. Pick by team capacity, not by claimed accuracy.
