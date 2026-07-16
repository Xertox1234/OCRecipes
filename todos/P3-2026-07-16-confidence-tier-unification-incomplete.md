<!-- Filename: P3-2026-07-16-confidence-tier-unification-incomplete.md -->

---

title: "Confidence-tier unification (client/lib/confidence.ts) left several screens on old, unmigrated thresholds"
status: backlog
priority: low
created: 2026-07-16
updated: 2026-07-16
assignee:
labels: [deferred, client, ai-prompting]
github_issue:

---

# Confidence-tier unification left several screens unmigrated

## Summary

PR #607 added `client/lib/confidence.ts` to unify 3 previously-inconsistent confidence-tier implementations (0.8/0.5 high/medium/low) into shared `getConfidenceTier`/`getConfidenceColor`/`getConfidenceLabel`/`getConfidenceHapticType` helpers. Code review found the migration didn't reach every screen that had its own independent threshold logic.

## Background

Found during code review of PR #607 (2026-07-16). Not in scope for that PR since none of the affected files were touched by its diff, but the split-brain result is real: `PhotoAnalysisScreen.tsx` still hardcodes 0.8/0.6 thresholds (a *third*, different cutoff set) for its `ConfidenceBadge` and a separate `confidence < 0.7` warning banner — for a real confidence score like 0.55, a user now feels the new unified "medium" Warning haptic (via `usePhotoAnalysis`, which PR #607 did migrate) while seeing a red "Low" badge (old 0.6 cutoff) for the same score on the same screen. That's the exact inconsistency the unification was meant to eliminate.

## Acceptance Criteria

- [ ] `client/screens/PhotoAnalysisScreen.tsx`'s `ConfidenceBadge` and its `CONFIDENCE_THRESHOLD` (`< 0.7`) warning banner migrated to `getConfidenceTier`/`getConfidenceColor`/`getConfidenceLabel` from `client/lib/confidence.ts`
- [ ] `client/screens/CookSessionReviewScreen.tsx`'s private duplicate `getConfidenceColor`/`getConfidenceLabel` (currently matching values, but drift-prone) swapped for the shared helpers
- [ ] Confirm `client/screens/SubstitutionResultScreen.tsx`'s binary High/Medium-only indicator is an intentional simplification for that domain, not an oversight — leave as-is if so
- [ ] `client/hooks/useSuccessAnimation.ts:38`'s raw `Haptics.notificationAsync` call (reachable via `RecipeActionBar.tsx` → `useSuccessPop`) either gets a reducedMotion-independent variant added to `useHaptics()`, or a small local Android-routing branch — note the existing reducedMotion-bypass there is intentional (comment: "tactile confirmation doesn't rely on motion"), so a naive swap to `useHaptics().notification()` would regress that; only the missing Android system-toggle routing is the actual gap

## Implementation Notes

- Reference implementation: `client/lib/confidence.ts`'s `getConfidenceTier`/`getConfidenceColor`/`getConfidenceLabel`/`getConfidenceHapticType`, already used correctly in `LabelAnalysisScreen.tsx`, `FrontLabelConfirmScreen.tsx`, `usePhotoAnalysis.ts`, `ScanScreen.tsx`, `ProductChip-utils.ts`
- `PhotoAnalysisScreen.tsx` is reachable/live (registered in `RootStackNavigator.tsx`, navigated to from `PhotoIntentScreen.tsx:137` and `scan-screen-utils.ts`), not dead code

## Dependencies

None — independent follow-up.

## Risks

- Changing `PhotoAnalysisScreen.tsx`'s thresholds from 0.8/0.6 to 0.8/0.5 is a user-visible behavior change (a 0.55-0.6 result flips from "Low" to "Medium" badge); call this out explicitly when implementing, don't bundle it silently.

## Updates

### 2026-07-16

- Filed from PR #607's code-reviewer findings (out-of-scope files, low severity)
