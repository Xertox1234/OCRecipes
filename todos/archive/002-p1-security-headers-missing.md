---
title: "No security headers (Helmet/CSP/HSTS)"
status: resolved
priority: critical
created: 2026-02-24
updated: 2026-02-24
assignee:
labels: [security, code-review, server]
---

# No Security Headers

## Summary

The Express server at `server/index.ts` has zero security headers — no helmet middleware, no X-Content-Type-Options, no X-Frame-Options, no Content-Security-Policy, no Strict-Transport-Security.

## Background

While this is primarily an API backend for a mobile app, the lack of security headers leaves the API vulnerable to clickjacking, MIME-type sniffing, and does not instruct browsers to use HTTPS.

## Acceptance Criteria

- [x] `helmet` middleware installed and configured
- [x] X-Content-Type-Options: nosniff
- [x] X-Frame-Options: DENY
- [x] Strict-Transport-Security header set
- [x] CORS origin matching uses strict equality (not `includes()`)

## Implementation Notes

- Install helmet: `npm install helmet`
- Add `app.use(helmet())` in `server/index.ts` after CORS setup
- Fix CORS: `server/index.ts` line 28 uses `origin.includes(publicDomain)` which is overly permissive

## Updates

### 2026-02-24

- Found during code review by security-sentinel agent
