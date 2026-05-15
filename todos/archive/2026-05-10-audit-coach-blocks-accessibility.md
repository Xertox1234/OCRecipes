---
title: "Coach block components: fix accessibility issues (M8–M13)"
status: completed
priority: medium
created: 2026-05-10
updated: 2026-05-11
assignee:
labels: [accessibility, react-native, coach]
github_issue:
---

# Coach block components: fix accessibility issues (M8–M13)

## Summary

Six coach block components have accessibility gaps found in audit 2026-05-10: state announcements, invisible elements, sub-44pt touch targets, and missing accessibilityState.

## Background

Audit 2026-05-10, findings M8–M13. These are all in `client/components/coach/blocks/`.

## Acceptance Criteria

### M8 — ActionCard

- [ ] Remove `accessible={false}` from outer container (or move to decorative children only)
- [ ] Add `accessibilityLiveRegion` to success/error state container
- [ ] Add `AccessibilityInfo.announceForAccessibility` on success/error transition (iOS)

### M9 — RecipeCard (coach block)

- [ ] Add `accessible={true}` to the outer `View` with `accessibilityLabel`
- [ ] OR restructure to make card content accessible without a dummy View wrapper

### M10 — RecipeCard touch targets

- [ ] "Add to Plan" Pressable: add `paddingVertical: 12` or `hitSlop={{ top: 14, bottom: 14, left: 8, right: 8 }}` to reach ≥44pt
- [ ] "View" Pressable: same treatment

### M11 — MealPlanCard

- [ ] Add `accessibilityState={{ expanded: isExpanded }}` to expand/collapse Pressable

### M12 — CommitmentCard

- [ ] Add `AccessibilityInfo.announceForAccessibility` on acceptance transition
- [ ] Expose checkbox visual via `accessible={true}` + `accessibilityRole="checkbox"` + `accessibilityState={{ checked: localAccepted }}`
- [ ] Increase accept/dismiss button touch targets to ≥44pt

### M13 — QuickReplies

- [ ] Increase chip `hitSlop` to `{ top: 16, bottom: 16 }` (or add `paddingVertical: 10`)

## Implementation Notes

Combine this work with M2 (React.memo) since both touch the same 7 files.

## Updates

### 2026-05-10

- Deferred from audit 2026-05-10 (M8–M13) — significant UI work, grouped into one todo

### 2026-05-11

- All acceptance criteria (M8–M13) already completed and merged via PR #117 (commit 9aa9b4c7) on 2026-05-12.
- Verified current state of all six files in `client/components/coach/blocks/`:
  - **ActionCard.tsx**: `accessible={false}` removed; `accessibilityLiveRegion="polite"` + `accessibilityState.disabled` on Pressable; iOS-gated `AccessibilityInfo.announceForAccessibility` on success/error.
  - **RecipeCard.tsx**: `accessible={true}` + `accessibilityLabel` on inner `info` View (chose restructure option to avoid trapping Pressable child focus).
  - **RecipeCard.tsx** touch targets: `minHeight: 44` + `paddingVertical: 12` + `hitSlop` on both View and Add to Plan Pressables.
  - **MealPlanCard.tsx**: `accessibilityState={{ expanded }}` on disclosure Pressable.
  - **CommitmentCard.tsx**: `AccessibilityInfo.announceForAccessibility` on accept; state rolled into parent group `accessibilityLabel` instead of `accessibilityRole="checkbox"` on non-Pressable View (kimi-review CRITICAL — checkbox role on non-interactive element misleads AT users); accept/dismiss buttons at `minHeight: 44` + `paddingVertical: 12` + `hitSlop`.
  - **QuickReplies.tsx**: chip `paddingVertical: 10` + `hitSlop: { top: 16, bottom: 16, left: 8, right: 8 }`.
- Patterns/learnings already codified in PR #117 (`docs/LEARNINGS.md` + `docs/rules/accessibility.md`).
- Todo was not archived previously because `todos/` is gitignored; archiving now.
- No additional implementation work required.
