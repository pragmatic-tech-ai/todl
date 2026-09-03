# AWS CloudShell

## Purpose

Browser-based shell pre-authenticated with console credentials. Common AWS CLIs and dev tools are preinstalled — no local setup required.

## Trade-offs

- Free, useful, frequently underused. Pre-authenticated CLI
  with persistent home directory makes ad-hoc operations
  faster than installing and configuring AWS CLI locally. Use
  it for one-off operations rather than reaching for kubectl
  through a bastion.
- Session caps and 1 GB persistent storage. Long-running
  background work, large file operations, or persistent
  development environments don't fit; reach for a real
  workstation or Cloud Development Environment.
- Auth context is whichever console role you're in. Switching
  roles drops CloudShell state — re-entering a new role gives
  you a different home directory. This is correct and
  occasionally surprising.
