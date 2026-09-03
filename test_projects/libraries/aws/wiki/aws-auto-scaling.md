# AWS Auto Scaling

## Purpose

Unified scaling-plan service across EC2, Spot Fleets, ECS tasks, DynamoDB tables, and Aurora Replicas. Adjusts capacity to maintain steady performance at the lowest cost.

## Trade-offs

- Distinct from EC2 Auto Scaling. AWS Auto Scaling is the
  cross-service scaling plan layer; per-service auto scaling
  (EC2 ASG, ECS task scaling, DynamoDB scaling) still exists
  underneath. The naming creates persistent confusion.
- Unified plans look appealing but rarely beat hand-crafted
  per-service policies in practice. Production teams usually
  end up configuring per-service scaling and skipping AWS
  Auto Scaling plans.
- Predictive scaling is shared with EC2 Auto Scaling — same
  data-history requirement, same caveats. Most production
  estates rely on target tracking plus headroom.
