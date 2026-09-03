# Amazon Nimble Studio

## Purpose

Cloud production environment for visual-effects, animation, and interactive content. Virtual workstations, high-speed storage, and elastic rendering for distributed creative teams.

## Trade-offs

- Effectively deprecated. AWS sunset Nimble Studio for new
  customers; existing pipelines have migration timelines.
  Replacement is to compose the same capabilities directly
  (AppStream + FSx + EC2 + Deadline / OpenCue).
- Was always vertical and narrow. VFX/animation studios with
  budgets, IT teams, and pipeline-engineering capacity got
  value; smaller shops found the operational surface too
  complex.
- Catalogue entry retained only for legacy reference. Treat
  as a hard-deprecated dependency.
