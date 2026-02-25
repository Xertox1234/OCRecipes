---
title: "Validate avatar upload MIME type from file content, not client header"
status: pending
priority: p3
created: 2026-02-25
updated: 2026-02-25
assignee:
labels: [code-review, security]
---

# Validate avatar upload MIME type from file content, not client header

## Summary

Avatar upload at `POST /api/user/avatar` trusts the client-provided `Content-Type` to construct the data URL. A malicious client could send an SVG with `Content-Type: image/jpeg`.

## Background

Found by: security-sentinel (L3)

**File:** `server/routes/auth.ts`, lines 206-208

Impact is limited since React Native renders images natively (not in a web context). But if avatars are ever displayed in a web admin panel, this could enable XSS via SVG injection.

## Acceptance Criteria

- [ ] Use `file-type` library (or magic byte check) to detect actual format from buffer
- [ ] Reject mismatched MIME types

## Updates

### 2026-02-25
- Created from code review (7-agent parallel review)
