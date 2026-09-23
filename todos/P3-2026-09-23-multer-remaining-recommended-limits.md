---
title: "Set multer's remaining recommended limits (files, fields, fieldNestingDepth)"
status: backlog
priority: low
created: 2026-09-23
updated: 2026-09-23
assignee:
labels: [deferred, security, server]
github_issue:
---

# Set multer's remaining recommended limits (files, fields, fieldNestingDepth)

## Summary

multer's README "Security" section recommends setting `files`, `fields` and `fieldNestingDepth` alongside `fieldArrayIndexLimit`. #1032 set only `fieldArrayIndexLimit` (the one an open advisory required). The other three are still at multer's defaults (`fieldNestingDepth` defaults to `Infinity`).

## Background

Raised by #1032's baseline review. This is pre-existing, not a regression, and no advisory is open for it. Both multer instances live in `server/routes/_upload.ts` and share `FIELD_NAME_LIMITS`, so one change covers every upload route.

## Acceptance Criteria

- [ ] `FIELD_NAME_LIMITS` (or a sibling constant) sets `fieldNestingDepth`, `fields` and `files` to the smallest values the real clients need.
- [ ] The values come from the client call sites: `FormData.append` in `useMenuScan.ts`, `useCookSession.ts` and `useReceiptScan.ts`, and `uploadAsync` `fieldName`/`parameters` in `photo-upload.ts`, `useAvatarUpload.ts` and `cookbook-cover-upload.ts`. The receipt route takes up to 3 `photos`.
- [ ] `server/routes/__tests__/_upload.test.ts` gains one rejection test per new limit, plus a control that the largest real request still passes.

## Implementation Notes

- multer rejects with a `MulterError` (`LIMIT_*` code), which `server/routes.ts` already maps to 400.
- Security label: never auto-merge; review individually.

## Updates

### 2026-09-23

- Filed from #1032 review.
