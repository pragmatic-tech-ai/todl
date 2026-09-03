# Amazon SageMaker AI Data Wrangler

## Purpose

Visual data-preparation feature inside SageMaker. Selects, cleans, explores, visualises, and engineers features through a single UI without bespoke pipeline code.

## Trade-offs

- Visual flows are great for exploration but ungrateful in
  diffs. The underlying graph serialises to JSON that's hard
  to code-review and easy to break in subtle ways across
  Data Wrangler version updates. Treat as an authoring tool,
  not a source of truth.
- Compiles to PySpark for production. The export step is real
  work — verifying the generated job matches intended behaviour,
  handling resource sizing, and integrating into Pipelines.
  Less "click to deploy" than the demos imply.
- vs. dbt / Spark notebooks / pandas pipelines: Data Wrangler
  wins on analyst-friendly UI for ML feature prep; dbt wins on
  analytics-engineering with versioned SQL; raw Spark is best
  when reproducibility and code review matter most.
