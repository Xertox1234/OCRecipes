<!-- Filename: P3-2026-06-23-smart-scan-chip-voiceover-announce-content-type.md  (P0=critical … P3=low) -->

---

title: "Smart-scan chip VoiceOver announce still says 'Photo analyzed' while the visible label is content-type-specific"
status: backlog
priority: low
created: 2026-06-23
updated: 2026-06-23
assignee:
labels: [deferred, accessibility, rn-ui-ux]
github_issue:

---

# Smart-scan chip iOS announce string lags the visible content-type label

## Summary

The `ProductChip` `smart_photo` variant now renders a content-type-specific
visible label via `getSmartConfirmLabel(phase.classification)` (e.g. "Restaurant
menu detected", "Not food detected"), but its iOS VoiceOver announcement is still
the hardcoded `"Photo analyzed, tap to confirm"`. So a VoiceOver user holding a
menu sees "Restaurant menu detected" on screen but hears the generic "Photo
analyzed" — a visible-vs-announced mismatch.

## Background

Surfaced as a deferred warning from the
`P3-2026-06-22-smart-scan-chip-content-type-label` todo (merged to `main` @
`36b6dea0`), which was explicitly scoped to the **visible** chip label only.

The announcement gap is **iOS-only**. On Android the chip container carries
`accessibilityLiveRegion="polite"`, which announces the rendered text (already
correct via `getSmartConfirmLabel`). iOS deliberately suppresses the live region
to avoid a double-announce and instead fires
`AccessibilityInfo.announceForAccessibility(...)` from a static
`announceText` map keyed by variant — and that map's `smart_photo` entry is the
stale generic string.

Matching the announced and visible content is a WCAG 2.1 concern (programmatic
name should reflect the visible label). Low severity: minor, iOS-only, and only
affects classification-only smart scans (menus / receipts / raw ingredients /
non-food) where `foods[]` is empty.

## Acceptance Criteria

- [ ] When the chip variant is `smart_photo`, the iOS announce string is derived
      from `getSmartConfirmLabel(phase.classification)` (e.g. "Restaurant menu
      detected, tap to confirm"), not the static "Photo analyzed, tap to
      confirm".
- [ ] Food-bearing classifications announce the food name (consistent with the
      visible label).
- [ ] All other variants keep their existing announce strings unchanged.
- [ ] The announce-string selection is covered by a Vitest unit test (extract a
      pure helper per the `*-utils.ts` pattern, mirroring `getSmartConfirmLabel`).

## Implementation Notes

- File: `client/camera/components/ProductChip.tsx` (~line 78–87) — the
  `announceText: Record<NonNullable<typeof variant>, string>` map inside the
  `useEffect`, gated to `Platform.OS === "ios"`.
- Type constraint: `phase.classification` exists only on the `SMART_CONFIRMED`
  phase (the source of the `smart_photo` variant), so it can't be read
  unconditionally while building the all-variant map. Either special-case
  `smart_photo` after the base map, or (cleaner) extract a
  `getChipAnnounceText(variant, phase)` pure helper into
  `client/camera/components/ProductChip-utils.ts` that switches on variant and
  calls `getSmartConfirmLabel(phase.classification)` for `smart_photo`. The
  helper keeps it unit-testable (the component itself can't be rendered under
  Vitest).
- Reuse the existing `getSmartConfirmLabel` helper
  (`client/camera/components/ProductChip-utils.ts:48`) — do not duplicate the
  food-name/content-type fallback logic.
- Suggested string shape: `` `${getSmartConfirmLabel(phase.classification)}, tap to confirm` ``.

## Dependencies

- None. Builds directly on the merged `getSmartConfirmLabel` helper.

## Risks

- Low. Pure additive change to an announce string + a new pure helper. No visible
  UI change; Android path is untouched.

## Updates

### 2026-06-23

- Filed from the deferred a11y warning surfaced by the smart-scan chip
  content-type-label todo (`/todo` run). Related: archived
  `todos/archive/P3-2026-06-22-smart-scan-chip-content-type-label.md`.
