# AWS IoT Events

## Purpose

Event-processing service for IoT telemetry. Detects events across thousands of sensors using if-then-else rules and triggers alerts or downstream actions.

## Trade-offs

- State-machine model is good for "device exceeds threshold for
  N minutes → escalate" patterns. For richer logic (cross-
  device correlations, complex temporal windows) a Lambda or
  Managed Flink job is more flexible.
- Per-event-evaluation pricing on top of IoT Core ingest cost.
  Layering many detector models on the same telemetry stream
  multiplies costs.
- vs. IoT Rules Engine + Lambda: Rules Engine + Lambda gives
  the same outcomes with more code. IoT Events wins on
  observability of state machines and on management-UI
  visibility; loses on logic flexibility.
