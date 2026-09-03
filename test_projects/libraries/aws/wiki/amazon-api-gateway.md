# Amazon API Gateway

## Purpose

Fully managed front door for application APIs at any scale. Exposes REST and HTTP endpoints that route to backends such as EC2, Lambda, or external web services, with built-in traffic management, authorization, monitoring, and version handling.

## Trade-offs

- Hard 29-second integration timeout. Long-running work behind the
  gateway must be reshaped into async patterns (Step Functions,
  SQS-then-Lambda) — synchronous handlers that occasionally take
  longer will fail unpredictably under load.
- HTTP APIs are roughly 70% cheaper than REST APIs but drop request
  validation, API keys with usage plans, edge-optimised endpoints,
  and AWS WAF binding. Pick REST when the policy surface matters,
  HTTP when raw routing is enough.
- vs. Application Load Balancer: ALB with Lambda targets is far
  cheaper at high RPS but has no throttling, quotas, transformations,
  or per-key auth. Use API Gateway for public APIs that need a policy
  layer, ALB for internal app traffic where the gateway features
  would sit idle.
