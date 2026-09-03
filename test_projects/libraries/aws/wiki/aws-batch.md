# AWS Batch

## Purpose

Managed batch-job submission and queuing. Dynamically provisions the optimal compute fleet for the queued jobs and reclaims it when work is done.

## Trade-offs

- Right tool when jobs are containerised, embarrassingly
  parallel, and tolerate spot interruptions. Wrong tool for
  long-running services, stateful pipelines, or jobs that need
  inter-task communication — Step Functions or a custom Spark/
  Slurm setup fits better.
- Compute environment design matters. Spot-only environments
  are cheap but require resumable jobs; on-demand-only environments
  are predictable but expensive. Mixed environments need careful
  queue-priority configuration to actually pay off.
- vs. ECS / Step Functions: ECS is more flexible for long-running
  services; Step Functions wins for orchestration with branching
  logic. Batch wins specifically for "submit thousands of jobs,
  optimise the fleet, retry on failure" — its dynamic
  provisioning is the differentiator.
