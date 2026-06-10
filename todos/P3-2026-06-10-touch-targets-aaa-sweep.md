<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "Touch-target AAA sweep: sub-44pt controls above the 24px AA floor"
status: backlog
priority: low
created: 2026-06-10
updated: 2026-06-10
assignee:
labels: [deferred, accessibility]
github_issue:

---

# Touch-target AAA sweep (44pt)

## Summary

Remaining sub-44pt touch targets from the 2026-06-10 full audit (finding L22,
AAA-only portion). The two WCAG 2.2 AA (24px) breaches — QuickLogDrawer
remove-x and ReceiptCapture thumbnail badge — were fixed with hitSlop in the
audit; these remaining controls clear 24px but miss the project's 44pt
(WCAG 2.5.5 AAA) bar.

## Background

Research calibration (Phase 2.5): 44px is AAA (2.5.5); the AA floor is 24px
(2.5.8). Items, approximate sizes:

- QuickLogDrawer `FrequentChip` (~23pt tall — borderline; re-measure first) and "Log All" button (~30pt)
- DailySummaryHeader calorie tap row (~20pt text row — re-measure with padding)
- CoachChat "Regenerate response" (~39pt)

Also note from the a11y review: RN clips hitSlop to the parent's bounds — a
hitSlop fix on a tightly-padded row caps out near the row height; prefer
`minHeight: 44` on the row container where layout allows.

## Acceptance Criteria

- [ ] Each listed control measured; anything under 24px fixed immediately (AA), the rest raised to ≥44pt via minHeight/hitSlop where layout permits
- [ ] No layout regressions (FrequentChip row wrapping, drawer height)

## Implementation Notes

- 4 CoachPro touch-target items from the 2026-06-03 audit are already separate deferred todos — don't duplicate.

## Dependencies

- None.

## Risks

- Visual-design tradeoffs; may want a quick design pass on the chips.

## Updates

### 2026-06-10

- Initial creation — deferred from 2026-06-10 full audit (L22 AAA portion).
