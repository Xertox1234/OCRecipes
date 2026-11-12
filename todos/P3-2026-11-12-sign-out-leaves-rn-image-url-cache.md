---
title: "Sign-out does not clear pictures loaded with react-native's own Image"
status: backlog
priority: low
created: 2026-11-12
updated: 2026-11-12
assignee:
labels: [deferred, client, privacy]
github_issue:
---

# Sign-out does not clear pictures loaded with react-native's own Image

## Summary

Privacy audit 2026-11-10, L4 residue. PR #1850 made the sign-out wipe clear expo-image's cache, but screens that still show remote pictures with react-native's `Image` cache them in the OS URL cache, which the wipe does not touch.

## Background

`clearDurableLocalState` (`client/hooks/auth-session.ts`) now calls `clearDeviceImageLeftovers` (`client/lib/device-leftovers.ts`), which clears expo-image's memory and disk cache. react-native's `Image` uses a different store (NSURLCache on iOS, Fresco on Android). Deferred from #1850 to keep that PR to the two files the audit named; owner chose "file a todo" (dialog, 2026-11-12).

## Acceptance Criteria

- [ ] Every `Image` from `react-native` in `client/` that can load a remote, account-specific picture is identified (a local `require(...)` asset or a `file://` capture is out of scope).
- [ ] Each of those renders through expo-image (`FallbackImage` or `Image` from `expo-image`), so the existing sign-out wipe covers it — or the todo records why one cannot move.
- [ ] No visual change: same sizing and fit as before on each moved screen.

## Implementation Notes

Importers of react-native's `Image` at filing time (`grep` on `client/`, tests excluded): `screens/CookSessionCaptureScreen.tsx`, `screens/FrontLabelConfirmScreen.tsx`, `screens/PhotoIntentScreen.tsx`, `screens/ProfileScreen.tsx`, `screens/ReceiptCaptureScreen.tsx`, `screens/PhotoAnalysisScreen.tsx`, `screens/LoginScreen.tsx`, `components/Card.tsx`, `components/RecipeDetailContent.tsx`, `components/HeaderTitle.tsx`, `components/IngredientIcon.tsx`, `components/profile/ProfileCard.tsx`. Several of these show only bundled assets or local captures — check each source before moving it.

expo-image's `contentFit` replaces `resizeMode` (it accepts `resizeMode` as a compat prop); `FallbackImage` is decorative by design and takes no accessibility label.

## Scope Contract

- **Mechanisms to use:** expo-image (`FallbackImage` / `Image`), already cleared by the sign-out wipe — nothing new.
- **Files in scope:** the files listed above and their `__tests__`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- Layout differences between the two image components (default fit, placeholder behaviour).

## Updates

### 2026-11-12

- Initial creation (deferred from PR #1850).
