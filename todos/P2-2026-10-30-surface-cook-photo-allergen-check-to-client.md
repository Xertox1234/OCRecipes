---
title: "Show cook-photo allergen warnings and allergen-check failure in the client"
status: backlog
priority: medium
created: 2026-10-30
updated: 2026-10-30
assignee:
labels: [deferred, client, allergens]
github_issue:
---

# Show cook-photo allergen warnings and allergen-check failure in the client

## Summary

`POST /api/cooking/sessions/:id/photos` returns `allergenWarnings` and (since the
2026-10-30 reliability audit, R44) `allergenCheckFailed`, but the client reads
neither, so an allergic user gets no warning from this route, and no notice when
the check could not run.

## Background

The R44 fix in the reliability-observability PR was server-side only. It logs a
failed allergen check and sets `allergenCheckFailed: true` instead of returning an
empty list that reads as safe. Review found that `client/hooks/useCookSession.ts`
(`useAddCookPhoto`) never reads either field. The client already ignored
`allergenWarnings` from this route before the fix. Wiring the UI is client work,
which is outside that server observability PR, so it was deferred.

## Acceptance Criteria

- [ ] `AddPhotoResult` (client type for the photo response) declares `allergenWarnings` and `allergenCheckFailed`. If the response goes through a Zod schema, the schema names both keys, because z.object strips unknown keys.
- [ ] `CookSessionCaptureScreen` (the `useAddCookPhoto` call site) shows the allergen warnings when the list is non-empty.
- [ ] When `allergenCheckFailed` is true, the screen tells the user the allergen check could not run, and does not show a "no allergens" state.
- [ ] Tests cover the pure mapping or display logic, using the `*-utils.ts` pattern.

## Implementation Notes

- Server producer: `server/routes/cooking.ts` (photo upload handler, `res.json({... allergenWarnings, allergenCheckFailed })`).
- Client consumer: `client/hooks/useCookSession.ts` → `useAddCookPhoto`. Find `AddPhotoResult` and the screen that calls `handleAnalyzePhoto`.
- The recipe-detail components already read a query-derived `allergenCheckFailed`. Reuse their warning UI where it fits.

## Scope Contract

- **Mechanisms to use:** the existing allergen-warning UI components and the response type
- **Files in scope:** `client/hooks/useCookSession.ts`, the cook-session capture screen and its `*-utils.ts`, and their `__tests__/`
- No new mechanisms, files, or abstractions beyond those listed.

## Updates

### 2026-10-30

- Filed from the reliability-observability PR review (code-reviewer and server-reviewer findings on R44).
