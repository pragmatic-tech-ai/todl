# AWS Amplify

## Purpose

Mobile and web backend provisioning plus client SDK. Integrates with iOS, Android, web, and React Native frontends and ships a hosted static-site CDN.

## Trade-offs

- Two products under one brand: Amplify Hosting (static-site
  CDN with Git-connected deploys) and Amplify (backend-builder
  framework). The hosting product is solid and used widely; the
  full-stack framework has had repeated churn between Amplify
  Gen 1 and Gen 2 with breaking migration paths.
- vs. Vercel / Netlify / Cloudflare Pages: dedicated frontend
  hosts lead on edge-function ergonomics, preview-deploy UX,
  and framework integrations. Amplify Hosting wins on
  AWS-native auth and tight CloudFront integration; loses on
  developer-experience polish.
- vs. Firebase / Supabase for backend-as-a-service: Firebase
  leads on mobile SDK maturity, Supabase on Postgres-friendly
  developer experience. Amplify's full-stack story is less
  cohesive — it's really a CDK wrapper with conventions.
