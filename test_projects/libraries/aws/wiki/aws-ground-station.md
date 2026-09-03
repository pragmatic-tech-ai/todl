# AWS Ground Station

## Purpose

Managed satellite-ground-station service. Controls satellite communications, downlinks and processes satellite data, and scales operations without building physical ground stations.

## Trade-offs

- Vertical-specific. Useful only when operating satellites or
  consuming satellite data through AWS-resident pipelines.
  Outside aerospace and Earth-observation, irrelevant.
- Per-minute reservation pricing with on-demand option. The
  cost model rewards plan-ahead scheduling; ad-hoc downlinks
  pay a premium. Plan satellite operations against the
  pricing window, not the orbital window alone.
- vs. KSAT / Viasat / Atlas Space / RBC Signals: dedicated
  ground-station-as-a-service vendors lead on station density
  in specific regions and on hardware-frequency support
  breadth. Ground Station wins on AWS-native data-pipeline
  integration to S3 / SageMaker.
