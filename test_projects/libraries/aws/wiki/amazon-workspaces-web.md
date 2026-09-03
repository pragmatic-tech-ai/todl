# Amazon WorkSpaces Web

## Purpose

Managed workspace facilitating secure access to internal websites and SaaS apps from regular web browsers — no appliances or specialised clients required.

## Trade-offs

- Browser-based isolation, not a full VDI. Useful for "let
  contractors access internal apps from their personal device"
  scenarios; not a replacement for WorkSpaces where users need
  installed software.
- Per-session pricing. Heavy continuous use (8h/day per
  contractor) approaches the cost of an Always-On WorkSpace
  without the application support. Pick by use shape, not by
  feature appeal.
- vs. Cameyo / Cloudflare Browser Isolation / Symantec Web
  Isolation: dedicated browser-isolation vendors lead on policy
  features, content disarm, and threat coverage. WorkSpaces
  Web wins on AWS-native auth and simplicity for AWS-resident
  apps.
