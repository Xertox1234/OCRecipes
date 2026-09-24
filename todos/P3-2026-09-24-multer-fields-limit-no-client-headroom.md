---
title: "multer `fields: 1` leaves no headroom — a second upload parameter from any client would 400 in production"
status: backlog
priority: low
created: 2026-09-24
updated: 2026-09-24
assignee:
labels: [deferred, server, client]
github_issue:
---

# Guard the `fields: 1` upload limit against a client adding a second parameter

## Summary

PR #1035 set `MULTIPART_LIMITS.fields: 1` in `server/routes/_upload.ts`, which fits every current
client exactly. A client that adds a second form field would fail every upload with 400
`LIMIT_FIELD_COUNT`, and nothing on the client side warns about it.

## Background

Raised by the security-auditor review of #1035 (no blocking findings). Client call sites that send
form fields: `client/lib/photo-upload.ts` lines 141 (`{ intent }`), 305-315 (optional `barcode`),
550 (`{ barcode }`).

## Acceptance Criteria

- [ ] A client-side test asserts each upload helper in `client/lib/photo-upload.ts` sends at most
      one non-file field, citing `MULTIPART_LIMITS.fields`
- [ ] A one-line comment at each `parameters` site points to `MULTIPART_LIMITS` in
      `server/routes/_upload.ts`

## Implementation Notes

- Files: `client/lib/photo-upload.ts`, `client/lib/__tests__/` (new or existing photo-upload test).
- Do not raise the server limit here; changing it is a security decision.

## Scope Contract

- **Mechanisms to use:** a unit test and comments; nothing new on the server.
- **Files in scope:** `client/lib/photo-upload.ts` and its test.
- No new mechanisms, files, or abstractions beyond those listed.

## Updates

### 2026-09-24

- Filed from the #1035 security-auditor review.
