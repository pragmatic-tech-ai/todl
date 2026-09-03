# AWS WAF Captcha

## Purpose

Bot-mitigation challenge layer atop AWS WAF. Audio fallback and WCAG-aligned design make it usable for assistive workflows.

## Trade-offs

- Not a separate service — a WAF feature. Captcha and Challenge
  actions are configured inside WAF rules; this catalogue entry
  exists because AWS lists it as its own product line.
- Captcha hurts UX. Use sparingly on hot endpoints; user
  abandonment from a wrongly-targeted captcha can outweigh the
  bot reduction. Silent Challenge is the lower-friction
  alternative for most cases.
- vs. hCaptcha / Cloudflare Turnstile: third-party captcha
  vendors lead on accessibility, mobile UX, and detection
  sophistication. WAF Captcha is the integrated option that
  needs no extra setup; reach for specialists when bot
  pressure is severe.
