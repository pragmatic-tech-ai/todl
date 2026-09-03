# Amazon Braket

## Purpose

Managed quantum-computing development environment. Builds and tests quantum algorithms in simulators and runs them on hardware backends from Rigetti and IonQ.

## Trade-offs

- Research and experimentation tool. Useful quantum computation
  on today's hardware is rare; Braket is for teams exploring
  quantum approaches, not for production workloads. Treat
  outputs as research, not business value.
- Per-shot pricing on hardware backends is expensive. Each
  hardware backend (IonQ, Rigetti, etc.) has its own per-task
  + per-shot fee; running experiments at scale is genuinely
  costly.
- vs. IBM Quantum / Azure Quantum / direct vendor access:
  Braket aggregates multiple hardware backends behind one
  AWS-native API. IBM and Azure provide their own portals
  with different hardware partners. Pick by hardware
  alignment to the research target.
