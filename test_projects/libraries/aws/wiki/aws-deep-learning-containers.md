# AWS Deep Learning Containers

## Purpose

Docker images preloaded with TensorFlow, PyTorch, and Apache MXNet. Deploy on SageMaker, EKS, EC2, or ECS to skip the framework-installation step for container-based ML workloads.

## Trade-offs

- Image set drifts. AWS updates the official tags but not as
  aggressively as upstream framework releases — production
  pipelines that need the latest CUDA / driver combo often
  build their own images and treat DLCs as a starting point,
  not a finished product.
- Tag sprawl is real. Variants per framework × Python version ×
  CPU/GPU × training/inference × region produce a large matrix;
  pinning the right tag for reproducibility takes discipline.
- vs. building from NVIDIA NGC / Hugging Face containers: NGC
  images carry NVIDIA's latest CUDA stack faster; HF containers
  package modern transformer stacks more cleanly. DLCs win on
  AWS-region availability and ECR-native pulls without rate-
  limit pain.
