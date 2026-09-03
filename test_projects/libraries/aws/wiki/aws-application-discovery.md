# AWS Application Discovery Service

## Purpose

Gathers configuration, usage, and behaviour data from on-premises servers to inform migration planning. Surfaces findings in AWS Migration Hub.

## Trade-offs

- Useful exactly during a migration window. Once workloads are
  in AWS, Application Discovery's value drops; it's not a
  long-running inventory tool.
- Agent-based vs. agentless discovery is a fit decision.
  Agentless via vCenter is faster to set up but less detailed;
  agents give richer process-level visibility but require
  installation across the estate.
- vs. Flexera / Movere / RVTools / vSphere reports: dedicated
  discovery tools predate Application Discovery and often give
  better breadth. Application Discovery wins when AWS is the
  target and Migration Hub will consume the findings directly.
