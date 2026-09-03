# Amazon Corretto

## Purpose

AWS-supported, no-cost distribution of OpenJDK. Long-term support, security fixes, and performance patches; runs on Amazon Linux 2, Windows, and macOS.

## Trade-offs

- AWS distribution of OpenJDK with long-term support and AWS
  performance patches. Use it on AWS-resident Java workloads;
  it's a fine default. Outside AWS the value proposition is
  weaker.
- vs. Eclipse Temurin / Microsoft Build of OpenJDK / Azul Zulu /
  Oracle JDK: alternative distributions are similar in quality.
  Pick by support-contract requirements, performance profile
  for the workload, and CI/CD tooling familiarity.
- Production estates standardise on one JDK distribution
  org-wide. Mixing Corretto and other distributions across
  pipelines is a source of subtle "works on my machine" bugs;
  pick one.
