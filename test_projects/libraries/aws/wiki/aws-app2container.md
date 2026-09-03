# AWS App2Container

## Purpose

Command-line tool that inventories .NET and Java workloads on existing VMs and packages them into container images plus CloudFormation deployment pipelines.

## Trade-offs

- Bootstrap tool, not a transformation. App2Container produces
  an image and a baseline pipeline; "containerised" is not the
  same as "twelve-factor". Stateful local files, registry edits,
  GAC dependencies, and Windows service hooks may all survive
  the wrapping and surface at runtime.
- .NET and Java only. Other languages need different approaches
  (Buildpacks, Dockerfile-by-hand). Workload coverage is
  narrower than "modernise legacy apps".
- vs. manual Dockerfile + AppDynamics-style discovery: A2C saves
  inventory and packaging effort for well-shaped legacy apps;
  ill-shaped apps require manual investigation regardless of
  tool. Plan A2C as one step in a larger modernisation
  programme, not the whole thing.
