# AWS Serverless Application Repository

## Purpose

Public and private repository of pre-packaged serverless applications. Each entry ships as an AWS SAM template ready to deploy with a single click.

## Trade-offs

- Public catalogue is sparse and uneven. Most production
  serverless work uses SAM or CDK templates internally rather
  than reaching into SAR. Treat SAR as a "sample app source",
  not a package manager.
- Private SAR is useful inside organisations for sharing
  pre-packaged stacks — but CDK constructs or shared CloudFormation
  modules usually serve the same need with better IDE support
  and refactoring.
- vs. CDK constructs / npm-distributed CloudFormation modules:
  CDK has won the share-pre-built-infrastructure mindshare.
  SAR remains useful only when SAM is the team's primary
  authoring tool.
