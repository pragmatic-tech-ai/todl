# AWS Device Farm

## Purpose

App-testing service running Android, iOS, and web apps against real devices. Captures video, screenshots, logs, and performance metrics for each test run.

## Trade-offs

- Per-device-minute pricing rewards parallel test execution.
  Slow sequential test runs waste money; investment in test-
  parallelism pays back faster than tuning individual tests.
- Device catalogue is curated, not exhaustive. The latest
  flagship and obscure regional phones may not be available;
  test matrices must work from the published catalogue, not
  ideal coverage.
- vs. BrowserStack / Sauce Labs / Firebase Test Lab: dedicated
  mobile-testing vendors lead on developer experience, IDE
  plugins, and device freshness. Device Farm wins on AWS-native
  IAM, integration with CodeBuild, and pricing for high parallel
  test loads.
