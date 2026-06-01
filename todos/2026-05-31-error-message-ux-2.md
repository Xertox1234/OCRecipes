---
title: "Error-message UX round 2 — 4 more screens leak raw ApiError message"
status: backlog
priority: medium
created: 2026-05-31
updated: 2026-05-31
assignee:
labels: [deferred, code-quality, client-state]
github_issue:
---

# Error-message UX round 2

## Summary

Four more screens render the raw `error.message` (`"<status>: <serverBody>"`) to the UI and/or VoiceOver, plus two fragile prefix-match error contracts. Same class as the now-merged `error-message-ux` todo (PRs #300/#308) — these are NEW files the first pass didn't reach.

## Background

`apiRequest()` (`client/lib/query-client.ts:186`) always throws `ApiError("<status>: <body>", code)` on non-ok. Per `docs/rules/client-state.md` and `docs/solutions/conventions/apierror-code-driven-static-copy-2026-05-31.md`, screens must show static user-safe copy and branch on `error instanceof ApiError && error.code === "<CODE>"` — never render `error.message`. Found in the 2026-05-31 code-quality re-run (manifest M1–M4, L2).

## Acceptance Criteria

- [ ] `CookbookCreateScreen.tsx:100-107` — stop setting/announcing raw `err.message`; static copy + `.code` branch (M1, strongest leak: UI + VoiceOver, full body)
- [ ] `RecipePhotoImportScreen.tsx:74,99,129,373` — replace `errorMessage = error.message` (rendered + announced) with `.code`-driven copy; the hook already carries `.code` (M2)
- [ ] `WeightLogDrawer.tsx:158,371` — `inputError` rendered via `<InlineError>` (announces too); use static copy + `.code` (M3)
- [ ] `LabelAnalysisScreen.tsx:169,189,254` — both `confirmLog.onError` and `verifyLog.onError` `setError(err.message)`; branch on `.code` (M4)
- [ ] `ChatListScreen.tsx:123-128` + `CoachChat.tsx:136` — replace `startsWith("401:")`/`startsWith("429")` prefix matching with `.code` branches (L2; maps to static copy today so no leak, but fragile)
- [ ] Per-route: confirm the actual `ApiError.code` emitted before writing each branch (verify server `sendError` codes)
- [ ] All existing tests pass; add screen-level coverage where a test harness already exists

## Implementation Notes

- Reference the merged pattern in the archived `error-message-ux` todo + the apierror-code-driven solution file for the exact idiom.
- VoiceOver: keep the iOS-gated `announceForAccessibility` but feed it the static copy, not the raw message.
- Do NOT pair `accessibilityLiveRegion` with `announceForAccessibility` (double-announce on Android).

## Risks

- Low. Pure UX-copy + branch changes; no data path touched. Verify each `.code` against the route to avoid a wrong branch.

## Updates

### 2026-05-31

- Filed from the 2026-05-31 code-quality re-run (bet-settlement audit), manifest `docs/audits/2026-05-31-code-quality-r2.md` findings M1–M4, L2.
