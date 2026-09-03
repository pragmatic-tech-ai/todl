# Amazon Inspector

## Purpose

Continuous vulnerability scanner over EC2 instances and ECR container images. Calculates contextualised risk scores using the Systems Manager Agent for runtime introspection.

## Trade-offs

- Requires the SSM agent for EC2 coverage. Anywhere SSM is
  blocked, broken, or missing, Inspector has no eyes — coverage
  gaps tend to correlate with the legacy hosts that need
  scanning most.
- ECR scanning is more mature than EC2 scanning. Container
  image findings are good; EC2 findings can be noisy and need
  suppression policy to be useful. Plan tuning time.
- vs. Wiz / Snyk / Qualys: third-party vulnerability scanners
  lead on cross-cloud coverage, application-dependency
  visibility, and SAST/SCA features. Inspector wins on
  AWS-native pricing and integration with Security Hub.
