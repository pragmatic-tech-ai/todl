# AWS App Runner

## Purpose

Fully managed PaaS for containerised web apps and APIs. Builds, deploys, and load-balances HTTPS traffic without exposing the underlying cluster.

## Trade-offs

- Pricing model is per-vCPU-second + per-GB-second with a real
  floor. App Runner makes sense for low-traffic services where
  the simplicity wins; high-RPS production apps are usually
  cheaper on ECS Fargate or EC2 + ALB.
- HTTPS-only and stateless. No raw TCP, no WebSocket-long-lived
  state assumptions, no background workers. App Runner is a
  web-front-end runtime; everything else needs a different
  service.
- vs. Fargate / Cloud Run / Heroku-style PaaS: App Runner is
  closer to Cloud Run than to Fargate — opinionated, simpler,
  less control. Pick when "deploy a container, get an HTTPS
  endpoint" is the entire requirement; reach for Fargate or
  EKS when networking, volumes, or scheduling matter.
