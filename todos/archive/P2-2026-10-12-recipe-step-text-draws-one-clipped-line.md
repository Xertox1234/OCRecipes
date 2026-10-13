---
title: "Recipe step text draws on one clipped line inside a two-line card"
status: done
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

- [x] The cause is found and stated in the PR. It is the step's position, not its string: slot 8 of local recipe 269557 measured 43.99988 instead of 44.
- [x] The clipping step wraps, checked in the simulator in light and dark mode. (Recipe 269362 no longer exists after a re-seed; checked on the slot that reproduced it.)
- [x] No other step regresses: a 40-step local recipe (1 to 8 lines per step) has 0 short text boxes, minimum slack 0.325pt.

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

### 2026-10-12 (fixed)

- Cause: iOS draws a Text into a container exactly its frame's size, and with no `numberOfLines` the last line that fits is clipped (`NSLineBreakByClipping`, RN `RCTTextLayoutManager.mm` `drawAttributedString`). Far down a long scroll, 32-bit float rounding returned a text frame 0.00012pt short (43.99988 for a 2-line step). A whole-number `lineHeight: 20` leaves no slack, so the last line was dropped. It follows the position: swapping the clipped string into slot 1 and a working string into slot 8 moved the clip with the slot. The hyphen and `flex` were not involved.
- Fix: `STEP_TEXT_LINE_HEIGHT = 20.001` in `client/components/recipe-detail/recipe-detail-utils.ts`, used by both step renderers. Every step now measures up to the next pixel (about 0.33pt of slack).
- Same mechanism applies to any whole-number `lineHeight` text, `Typography.body` included. Not changed here; raised in the PR.
