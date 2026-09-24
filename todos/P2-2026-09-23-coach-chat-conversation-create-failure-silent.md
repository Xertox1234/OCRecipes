---
title: "Coach Pro's first message fails silently when conversation creation errors — add feedback and a mutation error safety net"
status: backlog
priority: medium
created: 2026-09-23
updated: 2026-09-23
assignee:
labels: [deferred, audit, reliability, client-state]
github_issue:
---

# Coach Pro's first message fails silently when conversation creation errors — add feedback and a mutation error safety net

## Summary

When creating the first Coach Pro conversation fails (network hiccup, 5xx), CoachChat's bare `catch` clears the optimistic bubble and returns. The input was already cleared and the user gets no feedback. No global net catches mutation errors.

## Background

Found by the 2026-09-23 front-end audit (read-only, 6 lenses + Context7 research). Finding ID(s): **M17** in `docs/audits/2026-09-23-frontend.md` (local-only, gitignored). Each claim below was re-read against the code at HEAD `3df8b4b3`; line numbers may drift.

- `client/components/coach/CoachChat.tsx:396-404` bare catch; `client/screens/CoachProScreen.tsx:131-135` no try/catch; `client/hooks/useChat.ts:74-94` `useCreateConversation` has no onError; `client/lib/query-client.ts:299-305` global net covers queries only (by design, to avoid double toasts).
- Contrast: `CoachOverlayContent.tsx:150-157` handles the same failure visibly.
- Research (TanStack v5 MutationCache global callbacks): `better-fix`. Add a `MutationCache({ onError })` net that fires only when the mutation has no local `onError`/meta opt-out (mirroring `shouldSurfaceQueryError`), so errors can't be silently dropped without double-toasting.

## Acceptance Criteria

- [ ] CoachChat surfaces a visible error (and restores the typed text) when conversation creation fails
- [ ] Decide and implement (or explicitly reject, with rationale) a global MutationCache error net scoped to mutations with no local handler
- [ ] Tests for the CoachChat failure path (and the net, if added)
- [ ] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

## Implementation Notes

The global net is a cross-cutting change — if adopted, audit existing mutations for local handlers so nothing double-toasts.

## Scope Contract

- **Mechanisms to use:** existing project patterns cited above — nothing new beyond what the acceptance criteria name.
- **Files in scope:**
  - `client/components/coach/CoachChat.tsx`
  - `client/hooks/useChat.ts`
  - `client/lib/query-client.ts (only if the net is adopted)`
  - matching `__tests__/`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- A global mutation net can change behavior for every mutation — keep it opt-out-aware.

## Updates

### 2026-09-23

- Initial creation from the 2026-09-23 front-end audit (M17).
