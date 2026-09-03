# Amazon WorkSpaces Applications

## Purpose

Managed application streaming (formerly Amazon AppStream 2.0). Centrally manages desktop applications and securely streams them to any computer, including GPU-intensive 3D workloads.

## Trade-offs

- Application streaming vs. full desktop streaming is a real
  fit decision. AppStream (now WorkSpaces Applications) wins
  when only a handful of apps need to be delivered to a wide
  audience; full WorkSpaces wins when users need a complete
  desktop session.
- Per-streaming-instance-hour pricing. Always-on usage is
  expensive; on-demand fleets save money but pay cold-start
  cost. Tune the fleet auto-scaling carefully.
- vs. Citrix Apps / Microsoft AVD RemoteApp: vendor app-
  streaming products are deeper in policy and image
  management. WorkSpaces Applications wins on AWS-native
  setup and integration with Active Directory / Identity
  Center.
