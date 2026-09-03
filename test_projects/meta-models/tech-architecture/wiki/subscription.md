# Subscription

A **subscription** is a billing and resource container — an Azure subscription,
an AWS account, a GCP project, or an on-premises datacenter / billing unit.

## Key points

- Resources (networks, VMs, services) are owned by a subscription.
- Identity comes from the binding to a `tenant` (`in_tenant`), when applicable.
- A subscription is *placed* in a `location` via its `in` relationship.

## Distinctions

- Distinct from `tenant` (identity only).
- Distinct from `environment` (a deployment context with a lifecycle role).

One tenant can host many subscriptions; one subscription can host many
environments.
