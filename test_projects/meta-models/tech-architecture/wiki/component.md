# Component

A **component** is a first-class entity in the architecture — the unit that
runs in a `location` and participates in scenarios.

## Key points

- Carries a globally unique `id`, a display `label`, a category, and at most
  one `implemented_by` technology binding.
- Naming is purpose-first; the technology choice lives in `implemented_by`.
- Single-valued: a component is implemented by at most one technology at any
  point in time.

To express "either of two technologies could fill this slot," model the
alternatives as separate components.
