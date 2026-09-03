# AWS Deep Learning AMIs

## Purpose

EC2 AMIs preloaded with TensorFlow, PyTorch, Apache MXNet, and Keras. Removes the framework-setup cost of standing up a deep-learning environment from scratch.

## Trade-offs

- Saves the install pain but inherits the ops pain of running EC2.
  Patching, CUDA / driver compatibility, AMI age, and SageMaker
  feature gaps come with the choice. Long-lived DL AMI estates
  drift quickly without disciplined image refresh.
- vs. SageMaker Training / Studio: SageMaker provides the
  managed-job and notebook surface DL AMIs explicitly do not.
  Pick DL AMIs when the workload needs raw EC2 — custom MPI
  topologies, persistent multi-day training rigs, or research
  workflows that resist the SageMaker job lifecycle.
- vs. Deep Learning Containers: containers are usually shorter to
  manage because they version cleanly and compose with EKS/ECS.
  DL AMIs remain useful for spot-fleet training and bare-VM
  workflows.
