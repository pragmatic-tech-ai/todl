# Amazon GameLift Servers

## Purpose

Managed dedicated game-server hosting for session-based multiplayer games. Handles capacity scaling, player matchmaking, and DDoS defence.

## Trade-offs

- Vertical-specific. GameLift is a managed dedicated-server
  platform for session-based multiplayer; outside that pattern
  (MMOs, persistent worlds, large-scale battle royale) it
  doesn't fit and EC2 with custom orchestration is often
  better.
- Match-making and queue features are tightly coupled to
  GameLift's session model. Engaging only the fleet-management
  part and bringing your own matchmaker is awkward.
- vs. Multiplay (Unity) / PlayFab (Microsoft) / Photon /
  Hathora / self-managed on EC2: competing platforms lead on
  game-engine integration (Unity / Unreal); GameLift wins on
  AWS-native networking, FleetIQ spot management, and global
  region coverage.
