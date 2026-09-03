# Direct Connect

## Purpose

Vendor shortform of AWS Direct Connect — dedicated network circuit from premises to AWS with 802.1Q VLAN partitioning into multiple virtual interfaces. Same product as `aws-direct-connect`; this entry captures the AWS networking page's preferred display name.

## Trade-offs

- Same product as [`aws-direct-connect`](aws-direct-connect.md);
  this entry exists only because AWS pages display the shortform
  "Direct Connect" alongside the canonical name. Trade-offs are
  identical — see the canonical entry for detail.
- Use the canonical slug in models; the shortform is a label
  preservation aid, not a separate service. Tooling that
  fingerprints by slug should treat the two as aliases.
- If both slugs ever diverge in capability or pricing, this entry
  should be deleted, not duplicated. Today they do not.
