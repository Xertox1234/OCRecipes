---
title: "Label screen: servings count is exposed as a heading; the 'Scanned locally' badge overflows the title row"
status: backlog
priority: low
created: 2026-11-23
updated: 2026-11-23
assignee:
labels: [deferred, accessibility, client]
github_issue:
---

# Label screen: servings count is exposed as a heading; the "Scanned locally" badge overflows the title row

## Summary

Two small defects seen in an iOS Simulator check of `LabelAnalysisScreen` on `main` at `738040997`
(iPhone 17 Pro, iOS 26.5, light mode, default text size).

## Background

Found while checking #1990, #1993 and #2000 in the simulator. The check itself passed, and both items
are outside those PRs, so they are deferred here.

1. **Servings count is a heading.** `LabelServingsCard` renders the count with `ThemedText type="h3"`.
   `ThemedText` gives every `h1`–`h4` the `header` role (`client/components/ThemedText.tsx:64`), so the
   simulator's accessibility tree lists the element as `AXHeading` with the label "1 serving". A
   screen reader would announce a value as a heading, and it becomes a stop in heading navigation.
   Not heard on a device.
2. **Badge overflows the title row.** While the local preview is showing (before the AI result
   arrives, about 10 s in the check), the "Scanned locally" badge sits flush against the
   "Nutrition Facts" title with no gap, and its right edge runs about 23 pt past the card's content
   edge (badge right edge at x≈1100 px of 1206, the divider and value column end at x≈1030 px). The
   title row in `LabelNutritionFactsCard` has no gap, wrap or shrink for the badge. Larger text
   sizes were not checked and would be worse.

## Acceptance Criteria

- [ ] The servings count is not exposed with the `header` role; its label still reads "1 serving" / "1.5 servings"
- [ ] The "Scanned locally" badge stays inside the card's content width with a visible gap from the title at default text size on a 402 pt wide screen
- [ ] The badge does not overlap or clip the title at the largest supported text size (wrap below the title if needed)
- [ ] Simulator screenshot of the local-preview state attached to the PR

## Implementation Notes

- Item 1: check whether `ThemedText` lets a caller override `accessibilityRole` (it sets it from
  `type`); if it does, pass `accessibilityRole="text"` in `LabelServingsCard`, otherwise style a
  non-heading type to the same size.
- Item 2: `styles.nutritionTitleRow` and `styles.sourceBadge` in `LabelNutritionFactsCard`.
- To reach the local-preview state in the simulator, the screen needs `localOCRText` in its route
  params; the check used a temporary deep-link route in `client/navigation/linking.ts` (never
  committed) and a label image copied into the app container's `tmp/`.

## Scope Contract

- **Mechanisms to use:** existing props and styles only.
- **Files in scope:** `client/components/LabelServingsCard.tsx`, `client/components/LabelNutritionFactsCard.tsx`, their tests under `client/components/__tests__/`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- Changing `ThemedText` itself would touch every heading in the app; keep the change in the two cards.

## Updates

### 2026-11-23

- Initial creation
