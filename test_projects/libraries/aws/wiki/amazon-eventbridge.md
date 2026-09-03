# Amazon EventBridge

## Purpose

Serverless event bus for event-driven architectures. Routes events from AWS services, SaaS providers, and custom applications to targets such as Lambda functions, Step Functions workflows, and SQS queues.

## Trade-offs

- Cost compounds with fan-out: per-event ingestion + per-target
  invocation + archive + replay. Wide fan-out architectures should
  cost-model before committing; the bill grows faster than the
  event count suggests.
- vs. SNS + SQS: EventBridge gives content-based routing,
  schemas, and SaaS sources. SNS + SQS is materially cheaper and
  simpler when fan-out without filtering is the actual need.
  Reaching for the bus when a topic suffices is a frequent overbuild.
- Schema discovery is a separate service that has to be turned on
  and curated. Discovered schemas drift from intent unless someone
  owns them; expecting the registry to keep itself accurate from
  in-flight events alone leads to disappointment.
