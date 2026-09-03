# AWS Lambda

## Purpose

Function-as-a-Service runtime that runs code in response to triggers (HTTP, queue, event, schedule). Auto-scales to zero and charges only for invocation time.

## Trade-offs

- Hard limits shape architecture: 15-minute execution, 10 GB
  memory, 250 MB unzipped deployment package (or 10 GB container
  image), 6 MB sync invocation payload. Designs that bump these
  limits end up reshaping into Step Functions, Fargate, or ECS.
- Cold starts vary wildly. Node and Python on x86 are sub-100ms
  typical; JVM and .NET can be seconds; SnapStart (Java) and
  provisioned concurrency mitigate but cost extra. Latency-
  sensitive synchronous paths need cold-start strategy, not
  hope.
- vs. Fargate / ECS: Lambda wins on scale-to-zero, event-driven
  patterns, and tiny operational footprint. Fargate wins on
  long-running services, larger payloads, and predictable
  unit cost. The break-even is workload shape (bursty vs.
  steady), not magnitude.
