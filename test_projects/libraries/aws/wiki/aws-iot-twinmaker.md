# AWS IoT TwinMaker

## Purpose

Digital-twin builder for buildings, factories, and equipment. Combines 3D models with real-time sensor data for holistic operational views.

## Trade-offs

- Digital twin is a heavy concept lightly delivered. TwinMaker
  composes 3D scenes + entity graph + time-series — but the
  scene authoring, asset hierarchy modelling, and data
  connector wiring are all real work the team must do.
- vs. NVIDIA Omniverse / Microsoft Azure Digital Twins /
  Siemens Insights Hub: NVIDIA leads on rendering fidelity;
  Siemens on industrial-engineering depth; Microsoft on
  building-management modelling. TwinMaker fits AWS-resident
  industrial estates without strong tier-1 vendor partnership.
- Use case fit is narrow. Operational dashboards for facility
  managers and remote inspection do not always need a 3D twin
  — a 2D dashboard plus a floor plan is often enough.
