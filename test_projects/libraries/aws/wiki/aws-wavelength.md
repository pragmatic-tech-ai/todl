# AWS Wavelength

## Purpose

AWS infrastructure embedded inside CSP 5G networks (Wavelength Zones). Cuts round-trip latency for mobile-edge workloads — gaming, IoT, AR/VR, vehicular.

## Trade-offs

- Wavelength Zones are tied to specific telco partners in
  specific geographies. Coverage is genuinely sparse — globally
  available cloud edge it is not. Only suits applications where
  the user population maps to a Wavelength Zone's footprint.
- Service catalogue is narrower than in-Region AWS. EC2 and EBS
  with limited instance types; many AWS services aren't
  available at the edge. Plan architecturally for what's *not*
  in the zone, not what is.
- vs. CloudFront / Local Zones / Greengrass: CloudFront is cheaper
  and broader for HTTP edge; Local Zones bring AWS closer to
  metropolitan users without 5G dependency; Greengrass handles
  edge compute on customer-owned hardware. Wavelength's narrow
  niche is 5G-network-attached low-latency.
