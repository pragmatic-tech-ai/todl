# Amazon Q Developer

## Purpose

GenAI developer assistant (formerly CodeWhisperer). Helps with coding, testing, application upgrades, error diagnosis, security scans, and AWS resource optimisation through multistep planning.

## Trade-offs

- vs. GitHub Copilot / Cursor / Claude Code: Copilot and Cursor
  lead on IDE completion ergonomics and model quality; Claude
  Code on agentic CLI workflows. Q Developer wins on AWS-specific
  knowledge (CDK constructs, IAM policies, deeper service
  integration). Developer preference often beats vendor-strategy
  preference here.
- Tied tightly to AWS Builder ID / IAM Identity Center for SSO.
  Mixed-IdP organisations need to align before broad rollout, and
  the SSO friction is real for contractors and short-term
  collaborators.
- App-modernisation features (Java upgrades, .NET migration) are
  promising but uneven. Outputs need code review; the headline
  "click to upgrade your codebase" demos don't represent typical
  results.
