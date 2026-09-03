# PyTorch on AWS

## Purpose

AWS-supported distribution and tooling for the PyTorch framework. Includes TorchServe model serving and packaged availability via SageMaker, Deep Learning AMIs, and Deep Learning Containers.

## Trade-offs

- Branding banner, not a runtime. PyTorch on AWS = PyTorch +
  SageMaker / EC2 / EKS. Reference the actual compute service
  in architecture diagrams; treating "PyTorch on AWS" as its
  own product node leads to confused diagrams and confused
  cost models.
- AWS-provided PyTorch builds occasionally lag upstream releases
  by weeks. Cutting-edge research workloads benefit from
  upstream builds in custom containers; production workloads
  benefit from AWS-tested builds in DLCs.
- TorchServe is the AWS-favoured inference surface but Triton
  Inference Server (NVIDIA) is increasingly the production
  default for high-performance multi-model serving. Pick by
  performance requirements, not by which logo AWS puts on the
  landing page.
