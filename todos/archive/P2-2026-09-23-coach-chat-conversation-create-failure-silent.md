---
title: "Coach Pro's first message fails silently when conversation creation errors — add feedback and a mutation error safety net"
status: done
priority: medium
created: 2026-09-23
updated: 2026-09-25
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

- [x] CoachChat surfaces a visible error (and restores the typed text) when conversation creation fails
- [x] **Decided (user, 2026-09-25): add the net.** A global `MutationCache({ onError })` in `client/lib/query-client.ts` shows an error toast only when the failing mutation has no local `onError` and no meta opt-out (mirroring `shouldSurfaceQueryError`), so no failure is shown twice
- [x] Every existing `useMutation` is checked for a local error path (an `onError`, or a caller that catches `mutateAsync` and shows its own error). Any that would double-toast gets the meta opt-out; the PR lists what was checked
- [x] Tests for the CoachChat failure path (and the net, if added)
- [x] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

## Implementation Notes

The global net is a cross-cutting change — if adopted, audit existing mutations for local handlers so nothing double-toasts.

## Scope Contract

- **Mechanisms to use:** existing project patterns cited above — nothing new beyond what the acceptance criteria name.
- **Files in scope:**
  - `client/components/coach/CoachChat.tsx`
  - `client/hooks/useChat.ts`
  - `client/lib/query-client.ts` (the net)
  - mutation call sites that need the meta opt-out to avoid a double toast (meta-only edits)
  - matching `__tests__/`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- A global mutation net can change behavior for every mutation — keep it opt-out-aware.

## Updates

### 2026-09-23

- Initial creation from the 2026-09-23 front-end audit (M17).

### 2026-09-25

- **Product decision (user):** add the global mutation error net (opt-out-aware, never double-toasts), plus CoachChat's own visible error + restored text. Ready for `/todo`.

### 2026-09-25 (implemented)

- `CoachChat.tsx handleSend`'s bare catch now restores the typed text (`setInputText(content)`) and sets a visible `streamingError` ("Couldn't start the conversation. Please try again."), reusing the file's existing InlineError surface.
- `client/lib/query-client.ts`: added `MutationErrorMeta`/`shouldSurfaceMutationError` (a byte-identical mirror of `QueryErrorMeta`/`shouldSurfaceQueryError`) and a `MutationCache({ onError })` wired into `QueryClient`, reusing the existing `queryErrorListeners`/`subscribeToQueryErrors` toast bridge — no new mechanism.
- Audited every `useMutation` in the app (~68 call sites across ~33 files, not just `client/hooks/useChat.ts`). Hardcoded `meta: { silentError: true }` on hooks whose every call site already shows a visible error; threaded an optional `meta?: MutationErrorMeta` param through hooks whose call sites disagree (`useCreateConversation`, `useCreateGroceryList`, `useAddManualGroceryItem`, `useDeleteSavedItem`, `useToggleFavouriteRecipe`) so only the already-handled callers opt out; left unset (by design, documented per-hook) any hook with no prior visible handling, so the net now covers those for the first time — including three hooks (`useCookNutrition`, `useReceiptScan`, `useMenuScan`) where the SAME mutation instance is used from both a visible and a silent code path in one component, so opting out isn't mechanically possible without also silencing the still-silent path.
- Updated `docs/rules/client-state.md` and `docs/solutions/design-patterns/module-level-emitter-bridge-out-of-tree-to-toast-2026-05-28.md`, which both documented the now-reversed "queries only, never add MutationCache.onError" policy.
- New/updated tests: `client/lib/__tests__/query-error-net.test.ts` (mutation-side unit + integration tests, mirroring the query-side ones) and `client/components/coach/__tests__/CoachChat.branches.test.tsx` (extended the existing "creation fails" test to assert text restoration + visible error; confirmed it fails on the pre-fix code).
- Reviewed by `code-reviewer` + `mobile-reviewer` (both "No blocking findings"); addressed one WARNING inline (three already-audited-but-undocumented hooks got an explanatory comment).
- Deferred, out of this todo's scope: `RecipeChatScreen.tsx`'s `handleSend` has the identical silent-catch bug CoachChat had (same class as `docs/LEARNINGS.md`'s CoachChat/CoachOverlayContent SSE-parsing precedent) — flagged for the user, not fixed here.
