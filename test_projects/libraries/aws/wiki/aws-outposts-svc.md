# AWS Outposts

## Purpose

Provider-managed appliance extending AWS infrastructure into customer data centres and co-location facilities. Available as the AWS-native variant and as VMware Cloud on AWS Outposts.

## Trade-offs

- Capital commitment, not utility billing. Outposts ships as
  physical hardware on multi-year terms with data-centre power,
  cooling, and network prereqs. The "AWS in your DC" simplicity
  ends at the rack — site preparation is on you.
- Service coverage is a subset of in-Region AWS. Not every
  service available in a Region runs on Outposts; verify per
  service per generation. Architectures that drift Outposts-
  side into "everything we use in the Region" surprises late.
- vs. Azure Stack / Google Anthos: similar hybrid postures from
  the other hyperscalers. Pick by which cloud's services the
  on-prem workload primarily consumes; cross-cloud hybrid is
  rare and painful regardless of vendor.
