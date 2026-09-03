# AWS Snowball Edge

## Purpose

Edge-compute and data-migration appliance with five configurations — storage-optimised (and 210 TB), storage with EC2 compute, compute-optimised, and compute-optimised with GPU.

## Trade-offs

- Five configurations; configuration choice has multi-week lead
  time consequences. Wrong-fit configuration means re-ordering
  and waiting again. Plan the data shape (storage-heavy vs.
  compute-heavy vs. GPU) up front.
- "Edge compute" use is real but narrow. Disconnected ships,
  remote facilities, and ruggedised events benefit; for
  connected sites, EC2 in-region is usually simpler and
  cheaper.
- vs. Outposts: Outposts is permanent on-prem AWS infrastructure;
  Snowball Edge is a temporary or rotating-fleet appliance.
  Pick by duration and use shape, not by feature comparison.
