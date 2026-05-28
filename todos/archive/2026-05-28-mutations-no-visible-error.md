---
title: "Mutations with no user-visible error feedback (failed save/delete/log/toggle looks like a no-op)"
status: done
priority: high
created: 2026-05-28
updated: 2026-05-28
assignee:
labels: [react-native, client-state, hooks, error-handling]
github_issue:
---

# Mutations with no user-visible error feedback (failed save/delete/log/toggle looks like a no-op)

## Summary

Fifteen `useMutation` sites give the user no visible feedback on failure — `onError` is absent, or does only haptics / `console.error` / an iOS-only VoiceOver announcement. Two `await mutateAsync(...)` calls have no surrounding try/catch (genuine unhandled rejection, and the post-await navigation/reset never runs).

## Background

Silent-failures audit cluster 3 (`docs/audits/2026-05-28-silent-failures.md`, findings **H9, H10, M14–M24, L7, L8**). Phase 2.5 research (TanStack Query v5) verdict: `better-fix`, with two confirmed facts: (1) a global `MutationCache.onError` _always_ fires **in addition to** each local `onError` — so a global mutation toast must be `meta`-gated to avoid stacking on the ~91 existing handlers (this is exactly the concern noted in `todos/2026-05-28-global-query-error-handler.md`, which recommends scoping the global net to _queries_ and leaving mutations to local handlers). (2) `await mutateAsync()` without try/catch IS an unhandled rejection (`mutate()` routes to `onError` and swallows the promise; `mutateAsync()` rejects). So H10/M14 need a try/catch regardless of any global net.

## Acceptance Criteria

**High (health/goal data):**

- [ ] **H10** `GLP1CompanionScreen.tsx:80-100` + `useMedication.ts:20-48` — wrap `mutateAsync` in try/catch (or switch to `mutate` + `onError`); show a visible error; ensure resetForm/modal-close still happen. A medication-dose log must not silently fail.
- [ ] **H9** `useAdaptiveGoals.ts:30-56` (`useAcceptAdaptiveGoal`/`useDismissAdaptiveGoal`, onSuccess-only) + `AdaptiveGoalCard.tsx:94-102` — add `onError` with visible feedback; a failed goal adjustment must not look like a successful no-op.

**Medium:**

- [ ] **M14** `NotebookEntryScreen.tsx:140-146,157-163` — the mark-complete/archive fire-and-forget IIFE has no catch; on failure `goBack()` never fires (user stuck) and no error shows. Add try/catch + visible error.
- [ ] **M15** `HealthKitSettingsScreen.tsx:172-178` (sync) — render `isError`, not just `isSuccess`.
- [ ] **M16** `RecipeGenerationModal.tsx:96-109` — replace haptics + iOS-only announce with visible (cross-platform) error UI.
- [ ] **M17–M24** add visible `onError` to: `PantryScreen.tsx:154,164` (add/delete), `QuickAddSheet.tsx:152` (add-to-mealplan), `RecipeBrowserScreen.tsx:459` (empty catch + misleading "handled by mutation" comment), `CookbookListScreen.tsx:75` (delete), `CookbookDetailScreen.tsx:99` (delete), `NotebookScreen.tsx:66,80` (archive/delete), `AllConversationsScreen.tsx:91` (delete), `ChatListScreen.tsx:155` (delete).

**Low:**

- [ ] **L7** `MealPlanHomeScreen.tsx:649,660,833` (remove/reorder/confirm) and **L8** `HealthKitSettingsScreen.tsx:164-170` (data-type toggle) — add explicit error feedback (currently only a weak "snaps back on refetch" signal).

## Implementation Notes

- Preferred per-site fix: add `onError` to the hook's `useMutation` (or pass `onError` at the call site) that surfaces a visible error — Alert / InlineError / toast, consistent with each screen's existing convention. Haptics/console/iOS-only-announce do NOT count as visible feedback.
- For the two `await mutateAsync` sites (H10, M14): wrap in try/catch so the post-await side effects (reset, `goBack()`) are guarded and a rejection can't go unhandled.
- Do **not** rely on a future global `MutationCache.onError` for these — the filed global-handler todo deliberately scopes the global net to queries (to avoid double-toasting the ~91 local handlers). Mutations stay local-handler responsibility.
- Many delete mutations are `onSuccess`-only (confirmed for `useDeleteCookbook`/`useDeleteConversation`); the list only updates on success-invalidation, so a failure is fully silent today.
- `CoachRemindersScreen.tsx:84` toggle mutation (no `onError`) is the same class but belongs to the already-filed `todos/2026-05-28-coach-reminders-phantom-state-on-read-failure.md` — fold it there, not here.

## Dependencies

- Independent of the global-handler todo (that one covers queries, not these mutations).

## Risks

- Low. Additive error UX. Keep each surface's existing feedback convention (Alert vs InlineError vs toast) consistent.

## Updates

### 2026-05-28

- Created from silent-failures audit (themed-by-cluster triage). Mutation-no-onError pattern verified against `useDeleteCookbook`/`useDeleteConversation`; `mutateAsync` unhandled-rejection confirmed via TanStack Query v5 docs.

### 2026-05-28 (implemented)

- Implemented H9, M14–M24, L7, L8 via local `onError`/try-catch surfacing a visible `toast.error()` (matching ChatListScreen's established `useToast` convention) or, for HealthKitSettingsScreen sync, an inline `isError` banner. H10 and CoachRemindersScreen were already done on main and skipped.
- M16 (RecipeGenerationModal): removed the now-redundant iOS-only `announceForAccessibility` effect — the existing cross-platform error banner (`accessibilityRole="alert"` + `accessibilityLiveRegion="assertive"`) already announces on both platforms; the kept `onError` haptic plus the banner satisfy the "visible cross-platform error UI" criterion.
- M14 (NotebookEntryScreen) and M19 (AllConversationsScreen togglePin): wrapped `await mutateAsync` in try/catch so post-await `goBack()` is skipped on failure (user stays to retry) and the rejection can't go unhandled.
- No global `MutationCache.onError` added (queries-only net per `docs/rules/client-state.md`); no `meta.silentError` (query-only mechanism). Verify/type/lint/test all clean (5505 tests pass).
