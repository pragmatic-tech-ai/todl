# AWS DeepRacer

## Purpose

1/18-scale autonomous car for reinforcement-learning hands-on experimentation. Includes a cloud 3D simulator plus a real-world DeepRacer League event series.

## Trade-offs

- Effectively retired. AWS wound down the DeepRacer League and
  service investment; physical cars and online simulators may
  continue to function but should not anchor new programs.
- It was always an education and engagement product, not
  production infrastructure. Workloads that need real RL belong
  on SageMaker RL or open-source frameworks (Ray RLlib, Stable
  Baselines3); DeepRacer simulated only a narrow track-following
  problem.
- Retain the catalogue entry purely for legacy reference. Treat
  any architecture diagram still showing DeepRacer as a sign of
  staleness, not as a working dependency.
