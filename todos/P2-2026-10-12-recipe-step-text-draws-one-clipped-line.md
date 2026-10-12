---
title: "Recipe step text draws on one clipped line inside a two-line card"
status: backlog
priority: medium
created: 2026-10-12
updated: 2026-10-12
assignee:
labels: [deferred, ui]
github_issue:
---

# Recipe step text draws on one clipped line inside a two-line card

## Summary

Some recipe instruction steps render as a single line cut off at the right edge, even though their card is tall enough for two lines. QA sweep finding #30 is still open: PR #1417 changed the step text style, but the bug is still there.

## Background

Found by the orchestrator's simulator check of PR #1417 (iPhone 17 Pro, iOS 26.5). On recipe 269362 ("Italian Shrimp Scampi with Zucchini Noodles"), step 9, "Cook zucchini noodles for 2-3 minutes until slightly tender.", draws as "Cook zucchini noodles for 2-3 minutes until s" and is cut off. Steps 6, 7, 8, 10 and 11 wrap correctly. It clips the same way on `main` before #1417 (screenshots `~/qa-sweep-2026-10/verify1408/v1417-recipe-steps.jpg` and `v1417-main-steps.jpg`), so #1417's `flex: 1` → `flexShrink: 1` change did not cause it and did not fix it. The sweep first saw it on a different recipe's last step ("Serve lamb chops over the herbed couscous").

The card's height fits two lines while the text draws one. So the text is measured as two lines and then drawn without wrapping: a measure/draw mismatch, not a flex-layout problem. Not yet known: whether the trigger is the hyphen in "2-3", where the line breaks, or how the Poppins font is measured.

## Acceptance Criteria

- [ ] The cause is found and stated in the PR, with a string that reproduces it.
- [ ] Step 9 of recipe 269362 wraps onto two lines, checked in the simulator in light and dark mode.
- [ ] No other step regresses (check one recipe with long steps).

## Implementation Notes

- Rendering: `client/components/RecipeDetailContent.tsx` around `:430` (`stepBody`, `stepText`), styles around `:599-610`.
- First test whether the hyphen matters. Swap "2-3" for "2 to 3" in a local copy of the step and see whether it wraps.
- Things to try: an explicit `textBreakStrategy`/`lineBreakStrategyIOS` on the step text, and a width-constrained parent (`minWidth: 0` on `stepBody`).
- Reach it with `ocrecipes://recipe/269362` after `npm run seed:recipes`; the ids change on every re-seed, so look the recipe up by title.

## Scope Contract

- **Mechanisms to use:** React Native `Text` props and styles only.
- **Files in scope:** `client/components/RecipeDetailContent.tsx` and its `__tests__`.
- No new mechanisms.

## Dependencies

- None.

## Updates

### 2026-10-12

- Filed while reviewing PR #1417. That PR's todo Updates section lists #30 as done; this todo replaces that line.
