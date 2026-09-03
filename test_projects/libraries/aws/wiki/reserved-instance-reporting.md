# Reserved Instance (RI) reporting

## Purpose

RI-specific cost-management reports surfaced in Cost Explorer and Budgets. Tracks RI utilisation and coverage targets to maximise reservation discounts.

## Trade-offs

- Feature of Cost Explorer + Budgets, not a separate service.
  The catalogue entry exists because AWS positions RI reporting
  alongside other cost services on its pricing pages.
- RI utilisation and coverage reporting is essential for any
  estate that has bought RIs. Without it, expiring reservations
  and underutilised RIs are easy to miss until they hit the
  bill.
- vs. Savings Plans reporting: SP has its own reporting surface;
  the two work alongside but report on different reservation
  types. Many estates run both and need to reconcile.
