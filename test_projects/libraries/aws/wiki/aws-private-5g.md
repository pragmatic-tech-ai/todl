# AWS Private 5G

## Purpose

Pre-integrated private cellular network appliance — small cell radio units, servers, 5G core, RAN software, and SIM cards — delivered as a managed AWS service for enterprise sites.

## Trade-offs

- Lock-in extends to the physical layer: small-cell radios, SIMs,
  and core software all ship from AWS. Reversing the choice means
  replacing hardware, not just reconfiguring software.
- Overlaps awkwardly with Integrated Private Wireless. Same use
  cases, different operating model — AWS-managed appliance vs.
  CSP-managed network. Picking the wrong one is a multi-month
  commitment to a procurement and operations stack.
- Justified only by use cases where Wi-Fi genuinely fails: large
  industrial sites, ports, mines, distributed warehousing. Office
  or campus connectivity almost never repays the operational
  complexity of running a private cellular network.
