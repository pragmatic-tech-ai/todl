# Amazon SageMaker AI geospatial capabilities

## Purpose

Geospatial extension to SageMaker. Provides access to satellite and mapping datasets, processing primitives, visualisation, and pre-trained models tuned for geospatial workloads.

## Trade-offs

- Narrow audience. Genuinely useful for teams already doing
  satellite-imagery / Earth-observation work; outside that niche
  the pre-built operators and dataset access don't repay the
  added cost.
- Pre-trained models for tasks like land-cover classification are
  good baselines but not state-of-the-art. Most serious EO teams
  bring their own models (segmentation networks, time-series
  transformers) and use SageMaker geospatial mainly for the
  managed data access.
- vs. Planet / Sentinel Hub / Microsoft Planetary Computer:
  specialised geospatial-cloud vendors lead on imagery catalogues,
  pre-processing, and on-the-fly chunking. AWS competes on
  unified SageMaker integration, not on geospatial-specific
  depth.
