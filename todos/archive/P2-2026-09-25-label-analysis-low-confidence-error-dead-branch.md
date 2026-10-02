---
title: "LabelAnalysisScreen: dead low-confidence setError, and the confidence banner is never announced"
status: done
priority: medium
created: 2026-09-25
updated: 2026-10-01
assignee:
labels: [deferred, bug, accessibility]
github_issue:
---

# LabelAnalysisScreen: dead low-confidence setError, and the confidence banner is never announced

## Summary

In the upload effect's success path, when the AI analysis returns `confidence < 0.3` with no local preview data, `setLabelData(result.labelData)` and `setError(...)` are both called in the same synchronous continuation. Because the screen's only error-rendering branch is `if (error && !labelData)`, and `labelData` is already set by the time `error` is set, this error is never rendered to sighted users and never reaches the (newly added) `InlineError`/announcer path — it is dead on arrival.

## Background

Surfaced by the `mobile-reviewer` during the review pass for `todos/archive/P2-2026-09-23-label-analysis-silent-state-transitions.md` (WARNING, pre-existing/untouched by that diff, non-blocking, one-review-pass policy). Reviewer quote: "This instance of the error state is dead: never shown to sighted users, never announced, both before and after this fix."

As of the review, the relevant code in `client/screens/LabelAnalysisScreen.tsx`:

```tsx
} else {
  // No local preview or low confidence — use AI data directly
  setLabelData(result.labelData);
  setDataSource("ai");

  if (result.labelData.confidence < 0.3) {
    setError(
      "Could not read the label clearly. Try again with better lighting.",
    );
  }
}
```

and the only consumer of `error`:

```tsx
if (error && !labelData) {
  // ... renders <InlineError message={error} />
}
```

Since `labelData` is truthy by the time `error` is set, this branch can never trigger from this code path.

**Correction (review of #1078):** sighted users are NOT left without a warning. `getConfidenceTier` (`client/lib/confidence.ts`) maps every score below 0.5 to `"low"`, and the confidence-tier banner in the same screen already renders "Low confidence — review carefully before logging." for these results. The real gaps are narrower: (a) the `setError` copy is dead code, and (b) the confidence banner is never announced to screen readers, for the `low` AND `medium` tiers alike.

## Acceptance Criteria

- [x] The dead `setError(...)` call for `confidence < 0.3` in the upload success path is removed (the existing confidence banner is the visual warning; do NOT add a second visual surface).
- [x] When AI data with a `low` or `medium` confidence tier lands, the banner's text is announced to screen readers, folded into the existing merged announcer effect (the one combining "Ready to log" and "Updated with AI analysis") so it never fires as a second same-commit announce (`docs/solutions/logic-errors/two-announceforaccessibility-same-commit-collide-ios-2026-07-21.md`).
- [x] Failing tests first: a low-confidence and a medium-confidence AI result each produce exactly one announcement containing the banner text (`toHaveBeenCalledTimes(1)`); a high-confidence result's announcement is unchanged.

## Implementation Notes

- Route any new announcement through the existing merged announcer effect (the one that already combines the sessionId "Ready to log"/"Ready to submit verification" and "Updated with AI analysis" cases) rather than adding a third independent `AccessibilityInfo.announceForAccessibility` call — the two can land in the same commit as `sessionArrived`, and iOS drops the second of two same-tick announces.
- The visual warning already exists: the confidence-tier banner ("Low confidence — review carefully before logging." / "Some values may be inaccurate. Review before logging."). Do not add another banner; announce this one's text.

## Scope Contract

- **Mechanisms to use:** the existing merged announcer effect only — no new announcement mechanism and no new visual surface.
- **Files in scope:**
  - `client/screens/LabelAnalysisScreen.tsx`
  - `client/screens/__tests__/LabelAnalysisScreen*.test.tsx`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- Must avoid recreating the same-commit iOS double-announce collision this fix's sibling todo (P2-2026-09-23-label-analysis-silent-state-transitions, archived) just closed — route through the merged announcer, not a fourth independent effect.

## Updates

### 2026-09-25

- Filed from the mobile-reviewer's WARNING finding during the P2-2026-09-23-label-analysis-silent-state-transitions review pass.
- Rescoped after the #1078 review: the visible warning already exists; the work is removing dead code and announcing the existing banner.

### 2026-10-01

- Implemented (TDD, red then green). The dead `confidence < 0.3` `setError` is removed from the upload success path (`setError`/`error` have no other consumers: the catch path and the `error && !labelData` view). The confidence banner's copy is now computed once (`confidenceBannerMessage`), rendered from that, and spoken as the LAST part of the existing merged "Ready to log" / "Updated with AI analysis" announce: the same single `announceForAccessibility`, the same edge guards, no new effect, state, ref or visual surface. Ungated on both platforms, since the banner carries no live region or role.
- Judgment call, documented in the screen's comment and pinned by a test: the banner is spoken whenever the merged effect fires, so it also covers a medium-tier LOCAL preview that the AI merely confirmed (`labelData` stays the local parse, and that banner is what is showing at "Ready to log"). Limiting it to AI-only data would need new state, which the Scope Contract rules out.
- 8 new tests in `client/screens/__tests__/LabelAnalysisScreen.a11y.test.tsx`: low 0.2 and 0.4, medium 0.65, Android, verification mode, high unchanged, the three-part same-commit collision guard, and local-medium plus AI-confirms. They were red before the fix on the exact-string assertions (call count was already 1). The deletion of the dead branch has no behavioural delta, so its negative controls (no `alert` role, no error copy) pass before and after.
- Reviewed by `code-reviewer` + `mobile-reviewer` (one pass) at `ef326093`: mobile `No findings.`, code no blocking findings. One WARNING (the live-region pin read only the banner's container, so a live region on its text node slipped through) was fixed inline in `fe382a02` with a scratch mutation proving the strengthened pin goes red.
- Noticed, not filed: `client/screens/FrontLabelConfirmScreen.tsx` (~L275-300) renders the same kind of low-confidence banner with an inert `accessibilityRole="alert"` and no announce, so it has the same silent-banner gap.
