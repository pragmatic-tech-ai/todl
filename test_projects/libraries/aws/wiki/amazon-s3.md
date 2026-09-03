# Amazon S3

## Purpose

Object storage with 11-nines durability. Storage classes span Standard, Intelligent-Tiering, Express One Zone, Standard-IA, One Zone-IA, and the Glacier family for active through archive workloads.

## Trade-offs

- Per-request cost matters more than per-GB cost at scale.
  Hot prefixes throttle at ~3,500 PUT / 5,500 GET per second
  per prefix; metadata-heavy workloads (millions of tiny
  objects) feel the request bill long before the storage bill.
  Columnar formats + sensible prefixing fix both.
- Storage-class tiering saves money only on stable, predictable
  patterns. Intelligent-Tiering automates the choice but adds
  a per-object monitoring fee; misclassified objects (frequent
  access to "infrequent" tiers, early-deletes from Glacier
  Instant) erase the savings.
- vs. EBS / EFS / FSx: shared multi-AZ access and effectively
  unlimited capacity, but no POSIX semantics. Apps that mmap,
  do byte-range writes, or expect filesystem locking need a
  filesystem layer (Mountpoint for S3, s3fs, FSx) and accept
  its consistency caveats.
