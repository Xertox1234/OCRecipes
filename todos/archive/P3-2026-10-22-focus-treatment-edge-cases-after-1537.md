---
title: "Focus treatment edge cases left by #1537: nested ring in two sheets, 2px growth in compact fields, untested animation"
status: done
priority: low
created: 2026-10-22
updated: 2026-10-22
assignee:
labels: [deferred, ui, react-native]
github_issue:
---

# Focus treatment edge cases left by #1537

## Background

PR #1537 put every text input on `FocusTextInput` / `FocusBottomSheetTextInput`, which fade the input's own
1px border to the link colour on focus (a borderless style gets a transparent 1px border). Its reviewers left
three non-blocking suggestions, deferred under the one-review-pass rule:

1. **Nested ring (mobile-reviewer):** in `client/components/meal-plan/QuickAddSheet.tsx` (~line 419) and
   `SimpleEntrySheet.tsx` (~line 300) the ring is drawn on the inner input, inside a container box that is
   already tinted, so focus shows a ring within a box. Animating the container's border instead would give one ring.
2. **2px growth (mobile-reviewer):** the added 1px border grows `ServingStepperChip`'s edit input (padding 0,
   minWidth 24), the chat composers and the `NutritionStep` cells by 2px while editing.
3. **Untested animation (code-reviewer):** `client/components/__tests__/FocusTextInput.test.tsx` covers only
   prop and callback forwarding; nothing fails if the focus border stops animating or the borderless 1px rule breaks.

The todo #1537 closed also noted the chat composers "likely need a variant that animates the composer
container". The focus treatment's look itself waits on the owner's identity-pass pick (`DESIGN.md`).

## Acceptance Criteria

- [x] QuickAddSheet and SimpleEntrySheet show a single focus ring (the container's), not one inside another.
- [x] Compact fields (ServingStepperChip edit input, NutritionStep cells, chat composers) don't change size on focus.
- [x] A test fails if the focus border colour no longer changes on focus, and one fails if a borderless input
      loses its resting transparent 1px border.
- [ ] Device check (owner) of the Coach composer and one sheet input, light and dark.

## Implementation Notes

- Shared hook: `client/components/useFocusBorder.ts`; pure helpers in `client/components/text-input-utils.ts`
  (testable without rendering).
- For the size change, compensate the border with padding (or margin -1) in the compact styles rather than
  dropping the border.
- Don't change the treatment's colour, width or timing (`focusTimingConfig`) here; that waits on the owner.

## Dependencies

- None blocking. #1537 (merged 15c3fd20).

## Updates

### 2026-10-22

- Done: `compensateSyntheticBorder` (padding - 1, or margin -1 on a zero-padding side) cancels the synthesized border; both sheets draw one container ring (`focusRing={false}` on the inner input); `useFocusBorder` tests follow the animated colour. The device check (last criterion) is left to the owner.
