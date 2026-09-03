# Amazon Simple Workflow Service

## Purpose

State tracker and task coordinator for long-running background jobs with parallel or sequential steps. Predates Step Functions; still used for legacy SWF-based workflows with recovery and retry logic.

## Trade-offs

- Effectively legacy. AWS has steered new workflow work to Step
  Functions since 2016; SDK feature parity, documentation, and
  console investment have stagnated. Greenfield SWF is an
  anti-pattern.
- Operational drag: SWF requires running deciders and activity
  workers that you own. Step Functions runs the state machine for
  you. The hidden TCO advantage of Step Functions widens every
  year the SWF code base persists.
- vs. Step Functions: cheaper, faster to build, and integrates
  with most AWS services natively. SWF's only remaining niche is
  legacy investment too costly to migrate; even those usually pay
  back the migration within a year of operational savings.
