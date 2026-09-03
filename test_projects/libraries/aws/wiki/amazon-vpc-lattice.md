# Amazon VPC Lattice

## Purpose

Fully managed service-to-service connectivity layer across VPCs, compute services, and serverless functions. Policy-driven traffic management, access control, and observability without per-app networking plumbing.

## Trade-offs

- vs. App Mesh: Lattice hides the Envoy plumbing — no sidecars, no
  config files — at the cost of less control over the proxy
  behaviour. Choose Lattice when "managed service-to-service" is
  enough; reach for App Mesh or Istio when you need custom filters
  or fine-grained traffic shaping.
- Chatty service meshes get expensive: pricing is per-service per
  hour plus per-request, so high-RPS internal traffic that would
  otherwise traverse a plain NLB costs noticeably more under
  Lattice.
- Young surface area: the third-party observability and policy
  ecosystem (service maps, golden-signals dashboards, OPA
  integrations) lags App Mesh and Istio. First-party CloudWatch
  is fine; anything beyond it requires building it.
