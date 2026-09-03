# Amazon EC2 Auto Scaling

## Purpose

Adds and removes EC2 instances against fleet-management, dynamic-scaling, and predictive-scaling policies. Keeps applications healthy at the lowest cost without manual intervention.

## Trade-offs

- Step / target-tracking policies look simple but interact badly
  with instance warm-up time. Aggressive scale-out + slow warm-up
  + slow scale-in = flapping fleets. Production policies need
  careful cooldown and lifecycle-hook tuning.
- Predictive scaling needs weeks of historical pattern. New
  workloads can't use it; sporadic workloads confuse it. Most
  estates land on plain target-tracking + headroom, despite
  the predictive feature.
- vs. ECS/EKS scaling: container scaling at the task/pod level is
  finer-grained and faster. EC2 Auto Scaling still applies under
  it but plays a supporting role. Treat it as the bottom-tier
  capacity primitive, not as the application scaler.
