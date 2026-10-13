---
title: iOS Text loses its last line far down a long scroll — a whole-number lineHeight leaves no slack for float rounding of the frame
track: bug
category: logic-errors
tags: [react-native, ios, text, lineheight, layout, fabric, yoga, clipping]
module: client
applies_to: ["client/components/RecipeDetailContent.tsx", "client/components/recipe-detail/RecipeInstructions.tsx", "client/components/recipe-detail/recipe-detail-utils.ts", "client/**/*.tsx"]
symptoms: ["A wrapped Text draws one line fewer than its box is sized for — the card has room for 2 lines but shows 1", "The last drawn line is cut off mid-word at the right edge ('…until s') instead of wrapping", "Which item clips depends on its position in the list, not its words — the same string renders fine higher up", "onLayout reports a height a hair below N × lineHeight + padding (43.99988 instead of 44)"]
created: 2026-10-12
last_updated: 2026-10-12
severity: medium
---

# iOS Text loses its last line far down a long scroll — a whole-number lineHeight leaves no slack for float rounding of the frame

## Problem

Recipe instruction steps (QA sweep #30) sometimes drew one line fewer than their card was sized for. The last drawn line was cut off mid-word at the right edge. Re-seeding, changing `flex` to `flexShrink`, and suspecting the hyphen in "2-3" all went nowhere: the same sentence clipped in one slot and rendered fine in another.

## Root cause

Three facts combine:

1. **Drawing uses the frame exactly.** RN's `RCTTextLayoutManager drawAttributedString` (RN 0.81, unchanged in 0.83/0.84) builds its `NSTextContainer` at `frame.size`. With no `numberOfLines` it sets `lineBreakMode = NSLineBreakByClipping`, and `NSTextContainer.lineBreakMode` governs the *last line that fits*. A container even slightly too short drops the final line, and the line above it gets all the remaining text, clipped at the edge. That is the mid-word cut.
2. **The frame can come back a hair short.** Yoga lays out in 32-bit floats. Far down a long ScrollView (absolute y around 900+, with ⅓-pt offsets such as `.6666` that floats can't store exactly), a text frame's height came back as 43.99988 instead of 44, measured with `onLayout`. Card frames at the same offsets showed `68.0001`.
3. **A whole-number lineHeight has zero slack.** Measured height is rounded *up* to the pixel grid (`ceil(h × scale) / scale`). With `lineHeight: 20`, N lines measure exactly 20N, already on the ⅓-pt grid, so there is no headroom and any rounding shortfall drops a line.

Because (2) depends on accumulated offsets, the clip follows the *slot*. A swap test proves it: put the clipping string in slot 1 and a working string in slot 8, and the clip moves with the slot.

## Solution

Give the line height a tiny fractional part so N × lineHeight never lands on the pixel grid. The measured height then rounds up to the next pixel, about 0.33pt of slack, which absorbs the rounding:

```ts
// client/components/recipe-detail/recipe-detail-utils.ts
export const STEP_TEXT_LINE_HEIGHT = 20.001; // not 20 — see the doc comment
```

20.001 keeps N × 0.001 below ⅓ up to N ≈ 333 lines. The invariant is pinned by a unit test for 1–40 lines, which fails at 20. The change is invisible on screen.

Verified on the iOS 26.5 simulator:
- **Before:** at 20, 1 of 10 steps in the failing layout was short (43.99988).
- **After:** at 20.001, 0 of 10, and 0 of 40 in a 40-step stress recipe (1–8 lines each), with minimum slack 0.325pt.
- **Caveat:** the stress layout did not trigger the bug at 20 either (slack exactly 0.0). Whether a box comes out short depends on float details, so a non-clipping layout proves nothing about the old value.

## Prevention

- When a long list of wrapped Text shows a "last line missing, previous line cut mid-word" pattern, log `onLayout` height against `onTextLayout` line count × lineHeight before touching flex. A negative difference is this bug.
- Prove position-dependence with a swap test before suspecting the string's content.
- The mechanism applies to **every** whole-number `lineHeight`, `Typography.body` (24) included. Only recipe steps were seen clipping and only they were changed (PR #1420). If it shows up elsewhere, reuse the same fractional-slack approach rather than inventing a new one.
- No Vitest test can see the native draw. Verify on the simulator with a measured count, plus a control from a layout that actually fails.
