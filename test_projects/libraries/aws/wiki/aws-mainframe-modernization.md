# AWS Mainframe Modernization Service

## Purpose

Tooling and runtime for migrating on-premises mainframe workloads to AWS. Supports either replatform or refactor approaches with managed infrastructure.

## Trade-offs

- Mainframe modernisation is multi-year regardless of tool. AWS
  provides one path among several; the engineering work
  (COBOL conversion, JCL replacement, batch reordering, CICS
  emulation) dominates whatever cloud tool is chosen.
- Replatform vs. refactor is the load-bearing choice. Replatform
  (Micro Focus runtime on AWS) keeps the codebase; refactor
  (translate COBOL to Java) modernises but is far riskier.
  Most successful programmes stage replatform first, refactor
  later.
- vs. Micro Focus / Astadia / TSRI / Microsoft Mainframe
  Modernization on Azure: specialist mainframe-modernisation
  vendors bring decades of project experience. AWS's offering
  is competitive but the decision usually hinges on partner
  experience, not the platform features.
