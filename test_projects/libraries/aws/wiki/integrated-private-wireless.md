# Integrated Private Wireless on AWS

## Purpose

Marketplace program offering CSP-managed private 5G/4G LTE wireless networks pre-integrated with AWS services across Regions, Local Zones, Outposts, and Snow Family deployments.

## Trade-offs

- Marketplace overlay, not an AWS-operated service. Deployment is
  delivered by a CSP partner, billing flows through that partner,
  and AWS supplies the integration glue. Procurement is multi-party
  and timelines reflect that.
- Overlaps with AWS Private 5G but with a different operating model
  — partner owns the radios and the cellular core; AWS owns the
  cloud-side integration. Wrong-fit means switching vendors, not
  reconfiguring a service.
- Same narrow industrial use cases (factory, port, utility, remote
  site) as AWS Private 5G. Office, campus, or general enterprise
  connectivity almost never justifies the operational complexity
  of private cellular over modern Wi-Fi.
