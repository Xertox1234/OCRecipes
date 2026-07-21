---
title: "Badge family fails WCAG AA text/background contrast (AllergenBadge, VerificationBadge, ScanFlagBadge)"
status: backlog
priority: medium
created: 2026-07-20
updated: 2026-07-20
assignee:
labels: [deferred, client, accessibility]
github_issue:
---

# Badge family fails WCAG AA text/background contrast

## Summary

This todo covers TWO related badge-family accessibility gaps: (1) WCAG AA
contrast (below), and (2) a screen-reader grouping bug. On `AllergenBadge.tsx`
(~49-54) and likely `VerificationBadge.tsx`, the container `View` sets a composed
`accessibilityLabel` and `accessibilityRole="text"` but is **missing
`accessible={true}`**, so a screen reader can drill into the child `Text` and
read only part of the label (the same defect fixed for `ScanFlagBadge` in the
Phase 1 PR — see `docs/solutions/design-patterns/accessibility-grouping-pattern-2026-05-13.md`).
Fix the grouping (`accessible={true}`) on the siblings in the same pass.

The app's small "pill" badges render **severity/status-colored text on a
same-hue background at ~10% opacity** (`withOpacity(color, 0.1)`). Because the
background is mostly the light page color and the text is a mid-tone color of
the same hue, the text/background contrast fails WCAG AA — badly in light mode.
Measured (12px caption text; AA normal-text threshold is 4.5:1):

- `warning` (`#F57C00`) on its 10% fill over `backgroundRoot #FAF6F0`: **~2.3:1** (fails)
- `info` (`#2196F3`): **~2.6:1** (fails)
- `error` (`#D32F2F`): **~4.0:1** (fails 4.5:1; ~4.28:1 on `#FFFFFF` surface)
- Dark mode mostly passes, but dark `error` on `surface` is borderline (~4.24:1).

Affected components (same pattern):

- `client/components/ScanFlagBadge.tsx` (Smart Scan allergen safety badge — the
  driver for filing this; a **safety**-tier surface)
- `client/components/AllergenBadge.tsx`
- `client/components/VerificationBadge.tsx`

## Background

Surfaced during Smart Scan Phase 1 (Task 6, `ScanFlagBadge`). The plan told the
implementer to model `ScanFlagBadge` on `AllergenBadge`, so the new safety badge
inherited the existing contrast defect. Rather than fix one component in
isolation (which would make it look inconsistent with its siblings and still
needs on-device visual QA), the fix is tracked here as a **badge-family** pass.
The `accessible={true}` screen-reader-grouping fix for `ScanFlagBadge` was
applied in the Phase 1 PR; only the contrast remains.

Meaning is NOT conveyed by color alone (each badge has an icon + text label), so
this is a contrast/legibility failure, not a total loss of information — but it
still fails AA and hurts low-vision users, and one of the three badges is a
safety warning.

## Acceptance Criteria

- [ ] All three badges meet WCAG AA contrast (>= 4.5:1 for the caption text) in
      BOTH light and dark themes, against BOTH `backgroundRoot` and `surface`
      (badges appear on both).
- [ ] Approach chosen and applied consistently across the family: e.g. a darker
      per-severity text shade, a solid (full-opacity) fill with white/near-white
      text, or a raised-opacity fill paired with a darker text token — whatever
      passes the checker while staying visually coherent with the app.
- [ ] Verified with a contrast checker (WebAIM or equivalent) AND on device /
      emulator in both themes (this repo has a documented TalkBack-via-logcat /
      simulator practice) — not by eyeballing in code.
- [ ] No regression to the existing `accessible={true}` grouping or the
      severity→color/icon mappings.
- [ ] `AllergenBadge` (and `VerificationBadge` if it shares the pattern) get
      `accessible={true}` on their container `View` so their composed labels are
      announced as one unit — mirroring the `ScanFlagBadge` fix.

## Implementation Notes

- Shared pattern: `withOpacity(color, 0.1)` background + full-strength `color`
  text. See `ScanFlagBadge.tsx` (severity→`theme.error`/`theme.warning`/`theme.info`),
  `AllergenBadge.tsx:~51`, `VerificationBadge.tsx:~29`.
- `withOpacity` is in `client/constants/theme.ts:225`; theme color tokens are in
  the same file (`Colors.light` / `Colors.dark`).
- If introducing darker text shades, add them as named theme tokens rather than
  inline hex, so both themes stay centralized.
- Consider extracting a shared badge-pill primitive if the three components
  converge on identical styling — but only if it reduces duplication cleanly
  (YAGNI otherwise).

## Scope Contract

- **Files in scope:** the three badge components + their theme tokens/tests.
- **Out of scope:** the Smart Scan flag logic, routes, and other screens.
- No new mechanisms beyond what the chosen contrast fix requires.

## Risks

- A solid-fill redesign changes the visual weight of these badges app-wide —
  get a quick visual sign-off before shipping.
- Dark-mode and light-mode need independent verification; a fix that passes one
  can fail the other.

## Updates

### 2026-07-20

- Filed from Smart Scan Phase 1 (Task 6 review, mobile-reviewer). ScanFlagBadge
  got its `accessible={true}` fix in that PR; the family-wide contrast fix is
  tracked here.
