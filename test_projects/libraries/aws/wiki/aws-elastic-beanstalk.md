# AWS Elastic Beanstalk

## Purpose

Opinionated PaaS for Java, .NET, PHP, Node.js, Python, Ruby, Go, and Docker apps on classic servers (Apache, Nginx, Passenger, IIS). Handles capacity, load balancing, and auto-scaling.

## Trade-offs

- Maturity is now a euphemism for "behind". Elastic Beanstalk
  pre-dates ECS, EKS, App Runner, and Fargate; new investment
  is minimal. Greenfield deployments rarely justify it.
- Abstraction leaks. EB hides EC2, ASG, and ELB until something
  breaks; debugging requires understanding all three plus EB's
  glue. The "managed PaaS" label fades quickly during an
  incident.
- vs. App Runner / ECS / EKS: App Runner for stateless web
  services, ECS Fargate for container workloads needing more
  control, EKS for Kubernetes-aware teams. Elastic Beanstalk
  survives mainly in legacy estates that haven't migrated yet.
