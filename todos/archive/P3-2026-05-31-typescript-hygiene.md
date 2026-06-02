---
title: "TypeScript hygiene — theme: any + redundant req.id cast"
status: done
priority: low
created: 2026-05-31
updated: 2026-05-31
assignee:
labels: [deferred, typescript]
github_issue:
---

# TypeScript hygiene

## Summary

Two small typing nits with ready-made fixes: a `theme: any` param where a `Theme` type exists, and an inline `(req as { id?: string }).id!` cast that weakens then `!`-undoes already-correct typing.

## Background

Found in the 2026-05-31 code-quality re-run (L3, L4). Both defeat type-checking with no benefit; the correct types already exist in the codebase.

## Acceptance Criteria

- [ ] `client/screens/ProfileScreen.tsx:262` — type `ProfileSkeleton`'s `theme` prop as `Theme` (the type already used for this exact prop in `SuggestionCard.tsx:62`, `Toast.tsx:43`) instead of `any` (L3)
- [ ] `server/lib/request-context.ts:34` — remove `(req as { id?: string }).id!`; use `req.id` directly. pino-http globally augments `req.id: ReqId` and `genReqId` (`server/index.ts:108`) always returns a UUID, registered before this middleware — so `req.id` is already typed and always present (L4)
- [ ] `npm run check:types` clean; no runtime behavior change

## Implementation Notes

- L3: import `Theme` from wherever `SuggestionCard`/`Toast` import it.
- L4: confirm the pino-http type augmentation is in scope (it's global via `node_modules/pino-http/index.d.ts`); no local augmentation needed.

## Risks

- Minimal. Pure typing changes.

## Updates

### 2026-05-31

- Filed from the 2026-05-31 code-quality re-run, manifest L3 + L4.
