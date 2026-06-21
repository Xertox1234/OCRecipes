<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "Touch-target AAA sweep: sub-44pt controls above the 24px AA floor"
status: done
priority: low
created: 2026-06-10
updated: 2026-06-20
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
(2.5.8). Items, with exact render sites and approximate sizes (re-measure each
before changing — sizes are from the 2026-06-10 audit):

- **`FrequentChip`** (~23pt tall — borderline, may already clear the 24px AA
  floor): the `<Pressable>` in the `FrequentChip` component,
  `client/components/home/QuickLogDrawer.tsx:53-82` (Pressable at
  `client/components/home/QuickLogDrawer.tsx:63`).
- **"Log All" button** (~30pt): the `<Pressable onPress={onLogAll}>` styled
  `styles.logAllButton` in `client/components/ParsedFoodPreview.tsx:68` (NOT in
  a QuickLog file — it's the parsed-food preview, wired from
  `client/screens/QuickLogScreen.tsx:233`).
- **DailySummaryHeader calorie tap row** (~20pt — UNDER the 24px AA floor, fix
  immediately): the `<Pressable>` styled `styles.calorieTap` in
  `client/components/home/DailySummaryHeader.tsx:84-85` (the `calorieTap` style
  is at `client/components/home/DailySummaryHeader.tsx:141`).
- **CoachChat "Regenerate response"** (~39pt): the regenerate `<Pressable>` at
  `client/components/coach/CoachChat.tsx:504-509`.

The two WCAG 2.2 AA (24px) breaches already fixed with `hitSlop` in the audit
(for reference, do NOT re-touch): the parsed-item remove-x
(`client/components/ParsedFoodPreview.tsx:60-65`, `hitSlop={8}`) and the
QuickLogDrawer 14pt icon (`client/components/home/QuickLogDrawer.tsx:115-132`,
`hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}`).

Also note from the a11y review: RN clips `hitSlop` to the parent's bounds — a
`hitSlop` fix on a tightly-padded row caps out near the row height; prefer
`minHeight: 44` on the row container where layout allows.

## Acceptance Criteria

- [ ] `client/components/home/DailySummaryHeader.tsx` calorie tap row
      (`styles.calorieTap`, ~L84/L141) raised to ≥44pt effective target — this
      one is under the 24px AA floor, fix it first (prefer `minHeight: 44` on the
      row, not `hitSlop`, since the row is tightly padded).
- [ ] `client/components/home/QuickLogDrawer.tsx` `FrequentChip` Pressable
      (~L63) re-measured; if under 24px fix immediately (AA), else raised toward
      ≥44pt without breaking chip-row wrapping.
- [ ] `client/components/ParsedFoodPreview.tsx` "Log All" Pressable (~L68,
      `styles.logAllButton`) raised to ≥44pt.
- [ ] `client/components/coach/CoachChat.tsx` "Regenerate response" Pressable
      (~L504-509) raised to ≥44pt.
- [ ] No layout regressions (FrequentChip row wrapping, QuickLogDrawer height,
      DailySummaryHeader spacing) — verify on iOS and Android.

## Implementation Notes

- **Files in scope (all four render sites):**
  - `client/components/home/DailySummaryHeader.tsx` — calorie tap row
    (`styles.calorieTap`).
  - `client/components/home/QuickLogDrawer.tsx` — `FrequentChip` Pressable.
  - `client/components/ParsedFoodPreview.tsx` — "Log All" button
    (`styles.logAllButton`).
  - `client/components/coach/CoachChat.tsx` — "Regenerate response" Pressable.
- **Technique:** prefer `minHeight: 44` (and/or `minWidth: 44`) on the control's
  own style over `hitSlop`. RN clips `hitSlop` to the parent's bounds, so on a
  tightly-padded row (the DailySummaryHeader calorie row especially) `hitSlop`
  caps out near the row height and won't reach 44pt. Use `hitSlop` only where
  raising `minHeight` would break layout (e.g. inline chips).
- **Measure first:** the audit sizes are approximate. `FrequentChip` (~23pt) may
  already clear the 24px AA floor — confirm before deciding AA-urgent vs
  AAA-nice-to-have. The DailySummaryHeader calorie row (~20pt) is the only one
  clearly under AA.
- **Pure-function caveat:** these are visual/style changes with no extractable
  pure logic, so they aren't unit-testable via the usual `*-utils.ts` pattern —
  verify by measuring rendered targets on a simulator (iOS + Android), not via
  Vitest. There is no test to add; the AC is layout verification.
- 4 CoachPro touch-target items from the 2026-06-03 audit are already separate
  deferred todos — don't duplicate.
- Theming/styling conventions: use `useTheme()` + `withOpacity` (see
  `client/constants/theme.ts`); don't hardcode colors when touching these styles.

## Dependencies

- None.

## Risks

- Visual-design tradeoffs; may want a quick design pass on the chips.

## Updates

### 2026-06-10

- Initial creation — deferred from 2026-06-10 full audit (L22 AAA portion).

### 2026-06-20 (re-authored with explicit file paths)

- The 2026-06-20 `/todo` run dropped this todo on the `no-files` quality flag —
  the body named components (`FrequentChip`, `DailySummaryHeader`, etc.) but no
  file paths, so the dependency analyzer couldn't scope it. Re-authored with the
  exact render sites + line numbers for all four controls (verified by grep):
  - `client/components/home/DailySummaryHeader.tsx` (calorie tap row, ~L84/L141)
  - `client/components/home/QuickLogDrawer.tsx` (`FrequentChip`, ~L63)
  - `client/components/ParsedFoodPreview.tsx` ("Log All", ~L68)
  - `client/components/coach/CoachChat.tsx` ("Regenerate", ~L504-509)
- Notable correction: "Log All" is NOT in a QuickLog file — it lives in
  `ParsedFoodPreview.tsx`, wired from `QuickLogScreen.tsx:233`. Now executor-ready
  for the next `/todo` run.
