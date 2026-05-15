---
title: "TastePicksScreen/TasteProfileScreen: fix error handling in loadPicks, completeOnboarding, skipOnboarding"
status: done
priority: medium
created: 2026-05-10
updated: 2026-05-10
assignee:
labels: [code-quality, react-native]
github_issue:
---

# TastePicksScreen/TasteProfileScreen: fix remaining error handling gaps

## Summary

Three async handlers have `try/finally` without `catch`, meaning API failures propagate silently. Users see buttons un-spin with no feedback. These are the items deferred from the audit while H10/H11/H12 were fixed inline.

## Background

Audit 2026-05-10. H10/H11/H12 covered the primary handlers (`handleSave`, `handleContinue/handleSkip`, dead `if(!res.ok)` guards) and were fixed in the audit commit. The following remain:

- **M14**: `TasteProfileScreen.loadPicks` `useEffect` has no `try-catch` — `client/screens/TasteProfileScreen.tsx:31-41`
- **M16**: `OnboardingContext.completeOnboarding/skipOnboarding` are `try/finally` with no `catch` — `client/context/OnboardingContext.tsx:73-91`

## Acceptance Criteria

- [ ] `loadPicks` wrapped in `try-catch`; failure shows `setLoadError(true)` (reuse existing error state)
- [ ] `completeOnboarding` and `skipOnboarding` in `OnboardingContext` have `catch` blocks that surface errors to callers via a re-throw or an error state
- [ ] Screen reader users are informed of errors (pair with M1 fix for OnboardingContext)

## Updates

### 2026-05-10

- Deferred from audit 2026-05-10 (M14, M16)
- H10/H11/H12 were fixed inline during the audit
