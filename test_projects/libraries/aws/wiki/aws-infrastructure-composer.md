# AWS Infrastructure Composer

## Purpose

Browser-based visual composer for serverless apps. Drag-and-drop resources, then export deployment-ready CloudFormation and SAM artefacts.

## Trade-offs

- Sketch tool, not authoring tool. Useful for whiteboarding a
  serverless architecture quickly; the generated CFN/SAM is a
  starting point, not production-ready output. Treat as a
  diagram-with-code, not as an IaC tool.
- Round-tripping is one-way in practice. Composer can export
  templates and re-import, but real-world template files with
  parameters, mappings, and conditions don't round-trip
  cleanly. Pick Composer or CDK; trying to maintain both is
  painful.
- vs. CDK / SAM CLI direct: CDK gives full programmability and
  type-checked composition; SAM CLI gives template + local
  testing without the visual layer. Composer's niche is "I
  want to show this to a non-engineer".
