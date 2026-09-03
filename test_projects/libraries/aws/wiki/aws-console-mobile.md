# AWS Console Mobile Application

## Purpose

Mobile dashboard for managing a subset of AWS resources during incident response. Tracks configuration, metrics, and alarms for select services.

## Trade-offs

- Narrow service coverage. Useful for "see if the alarm is
  still firing" and limited triage actions; not a substitute
  for the web console. Incident response from a phone hits the
  ceiling fast.
- Auth is tied to the mobile device. Adding the device, MFA,
  and SSO setup is per-engineer toil that's worth doing
  proactively, not during an incident.
- Use as a glance-tool. Page-and-acknowledge workflows belong
  in PagerDuty or Opsgenie; the AWS Console Mobile app
  supplements those by showing the underlying service state.
