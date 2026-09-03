# Amazon WorkSpaces

## Purpose

Managed cloud-desktop service running Windows or Linux. Provisions thousands of desktops in minutes and bills monthly or hourly per WorkSpace.

## Trade-offs

- Windows licensing economics dominate. License-included
  WorkSpaces are pricier than BYOL when the customer has
  appropriate licensing; the per-user cost gap compounds across
  large fleets. Audit licensing before commit.
- Network latency matters more than the marketing admits.
  WorkSpaces over residential broadband works for office tasks;
  video editing, CAD, and high-frame-rate workloads benefit
  from PCoIP / WSP tuning and may still feel laggy.
- vs. Citrix DaaS / Microsoft AVD / VMware Horizon: VDI vendors
  lead on policy, image management, and brokering features.
  WorkSpaces wins on AWS-native pricing and quick rollout;
  loses on the deep VDI operations features that
  large-enterprise fleets eventually need.
