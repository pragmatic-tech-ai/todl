# Apache MXNet on AWS

## Purpose

AWS-packaged distribution of the Apache MXNet deep-learning framework. Provides a concise Gluon API for ML beginners and supports cloud, edge, and mobile deployment.

## Trade-offs

- MXNet is effectively dormant upstream. Apache retired the
  project in 2023; the wider ML ecosystem has moved to PyTorch
  for research and JAX/PyTorch for production. New work should
  not start on MXNet.
- AWS bundles it for compatibility with legacy SageMaker and
  Deep Learning AMI images, not because it's the recommended
  stack. Catalogue entry exists so legacy architectures map
  cleanly; greenfield architectures should pick PyTorch or
  TensorFlow.
- Migration target depends on the model: most MXNet work
  ports to PyTorch with manageable effort; some Gluon-specific
  patterns require restructuring. Budget real engineering time
  for the rewrite, not a flag flip.
