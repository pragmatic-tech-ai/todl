# Amazon EC2 Image Builder

## Purpose

Simplifies the build-test-deploy cycle for VM and container images. Provides a GUI plus automation pipeline so AMIs stay current without hand-built tooling.

## Trade-offs

- Useful exactly when AMIs are part of the deployment model.
  Container-only estates and Lambda-heavy estates rarely need
  it; long-lived EC2 fleets with custom hardening and software
  pre-installation benefit most.
- vs. Packer + CodeBuild / GitHub Actions: Packer is more
  portable, more inspectable, and integrates with non-AWS
  registries. Image Builder wins on AWS-native auth and
  cross-region distribution; loses on cross-cloud reach and
  pipeline expressiveness.
- Test phase is structural but you provide the tests. Image
  Builder runs the test components you supply; it doesn't
  catch configuration drift unless someone writes the tests
  that would surface it. "Validated AMI" is only as strong
  as the test suite.
