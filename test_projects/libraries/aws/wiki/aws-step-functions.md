# AWS Step Functions

## Purpose

Visual workflow service coordinating distributed applications and microservices. Defines state machines as JSON; automatically initiates, tracks, and retries each step.

## Trade-offs

- Express vs. Standard is a load-bearing choice. Express is
  sub-cent and sub-five-minute, designed for high-volume short
  workflows; Standard handles multi-hour human-approval shapes
  but per-state-transition cost is orders of magnitude higher.
  Mixing them poorly produces large bill surprises.
- Hand-edited ASL (Amazon States Language) JSON loses readability
  past ~30 states. Mature teams compose with CDK constructs or
  Workflow Studio; raw JSON for complex workflows is a long-term
  maintenance burden.
- vs. orchestration alternatives: Step Functions wins for
  AWS-native task orchestration with a strong service-action
  catalogue. Airflow (MWAA) fits cron-shaped Python DAGs with
  custom operators; Temporal fits durable code-as-workflow
  patterns that don't decompose well to a state machine.
