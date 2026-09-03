# Amazon SageMaker AI Canvas

## Purpose

No-code visual interface inside SageMaker giving business analysts predictive-modelling capability without writing code.

## Trade-offs

- Per-user pricing plus underlying compute can surprise. The
  marketing emphasises "no-code"; the bill still reflects
  Autopilot-scale exploration runs underneath. Budget reviews
  catch this late.
- Outputs are inspectable but not directly portable. A model
  built in Canvas is hard to lift into a custom CI/CD pipeline
  without re-implementing in code. Treat Canvas-built models as
  analyst tools, not production assets.
- vs. Tableau Prep + Einstein / Power BI + AutoML: Canvas fits
  Salesforce-/Microsoft-light estates already on AWS; analysts
  in Tableau-heavy or Microsoft-heavy environments often get
  shorter time-to-value from the BI vendor's native ML extension.
