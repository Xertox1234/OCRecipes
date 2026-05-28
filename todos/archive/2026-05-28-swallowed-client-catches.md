---
title: "Swallowed client catches drop a result the user is waiting on (.catch(()=>{}) / console+haptic-only)"
status: backlog
priority: medium
created: 2026-05-28
updated: 2026-05-28
assignee:
labels: [react-native, hooks, error-handling]
github_issue:
---

# Swallowed client catches drop a result the user is waiting on

## Summary

Four explicit client-side error swallows discard a failure the user is actively waiting on, with no visible feedback. Distinct from the query/mutation clusters — these are hand-written `.catch(()=>{})` / console+haptic-only catches, so no global error net will ever cover them.

## Background

Silent-failures audit cluster 5 (`docs/audits/2026-05-28-silent-failures.md`, findings **M12, M13, L5, L6**). These were separated from the (correctly excluded) best-effort/fire-and-forget swallows — auth-cleanup empties, temp-file cleanup `.catch`, product-chip enrichment, and `acknowledge()` mark-seen are all intentional and were NOT flagged. Phase 2.5 research verdict: `not-applicable` (custom code, no library behavior in play). The already-filed `todos/2026-05-28-scan-ocr-swallow-and-vestigial-params.md` covers the ScanScreen STEP-flow OCR swallow — not in scope here.

## Acceptance Criteria

**Medium:**

- [ ] **M12** `useAvatarUpload.ts:75` — the catch does `console.error` + an error haptic only, and the hook returns no error field; the sole consumer `ProfileCard.tsx:80` reads only `isUploadingAvatar`. Surface a visible failure (avatar silently reverts today with no notice).
- [ ] **M13** `CookSessionReviewScreen.tsx:89` — `.catch(() => { /* may fail silently */ })` leaves the "Calculating nutrition…" spinner replaced by empty space (footer renders `null`). Show an error/retry for the cook-session nutrition the user is waiting on.

**Low:**

- [ ] **L5** `RecipeDetailContent.tsx:427` — `WebBrowser.openBrowserAsync(...).catch(()=>{})`; a tapped affiliate "Tools Required" link that fails to open gives no feedback. (Low — user can re-tap.)
- [ ] **L6** `useTTS.ts:88` — `Speech.speak` onError only resets state; read-aloud failure plays no audio with no notice. (Low — content stays readable on screen.)

## Implementation Notes

- M12: add an `error` to the hook return (or surface inline) so `ProfileCard` can show "Avatar upload failed". The success path calls `checkAuth()` to refresh; the failure path currently does nothing visible.
- M13: the inline comment already acknowledges the silent failure — replace with a visible error state in the footer's `nutrition ? … : isLoadingNutrition ? … : null` ladder (the trailing `null` is the silent branch).
- L5/L6: minimal — a toast/Alert on the swallowed branch, or (L6) leave as-is if read-aloud failure is deemed acceptable given the text is on screen. These are disposable.

## Dependencies

- None. A global query/mutation error net does NOT cover these (hand-written catches).

## Risks

- Low. Additive error UX on user-initiated actions.

## Updates

### 2026-05-28

- Created from silent-failures audit (themed-by-cluster triage). M12/M13 re-read against source (M13's "may fail silently" comment confirmed); best-effort swallows deliberately excluded.
