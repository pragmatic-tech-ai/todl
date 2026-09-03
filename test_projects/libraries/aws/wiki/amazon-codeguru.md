# Amazon CodeGuru

## Purpose

ML-driven code analysis combining CodeGuru Reviewer (critical issues, vulnerabilities, bugs from automated reasoning) and CodeGuru Profiler (most-expensive code paths from runtime behaviour).

## Trade-offs

- Largely absorbed into Q Developer. AWS is steering new
  investment into Q Developer's review and suggestion features;
  standalone CodeGuru is essentially in maintenance and likely
  not the right new-build choice.
- Reviewer's false-positive rate on idiomatic code is high enough
  that triaging the findings often costs more than the bugs it
  catches. Best results come from narrow scopes — sensitive
  modules, security-critical paths — not whole-repo sweeps.
- vs. SonarQube / Snyk / Semgrep: CodeGuru integrates natively
  with CodeCommit/CodeBuild but lags on language coverage,
  rule extensibility, and CI ergonomics. Greenfield static-
  analysis adoption should consider whether AWS-native is worth
  the trade against a tool the developers can configure.
