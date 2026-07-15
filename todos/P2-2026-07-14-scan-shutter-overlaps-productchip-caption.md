<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "Scan screen shutter button visually overlaps ProductChip's caption text"
status: backlog
priority: medium
created: 2026-07-14
updated: 2026-07-14
assignee:
labels: [camera, ui, layout]
github_issue:

---

# Scan screen shutter button visually overlaps ProductChip's caption text

## Summary

On the scan screen, the shutter button and the `ProductChip`'s instructional caption text (e.g. "Point at the Nutrition Facts panel to continue." in the `barcode_lock` phase) render as two independently-positioned, full-width, bottom-anchored absolute containers with no offset between them — the gold-ringed shutter button visually sits on top of / obscures the caption text.

## Background

Reported by the user on-device while testing the scan camera overhaul (PR #620/#623): "the scan button is still very much in the way." Confirmed via screenshot — the shutter's yellow "armed" ring overlaps directly with the ProductChip's bottom caption line.

## Acceptance Criteria

- [ ] The shutter button and the ProductChip's content (especially caption text in `barcode_lock`/`step2_confirmed`, and the review card in `step2_review`/`step3_review`) never visually overlap at any phase, on any tested device size
- [ ] Existing shutter tap target and armed-state styling (gold ring, glow) are unaffected
- [ ] No regression to `ProductChip`'s existing layout/spacing for phases that don't render a caption (session_complete, etc.)

## Implementation Notes

Root cause (traced, not guessed):

- `client/screens/ScanScreen.tsx` — `styles.controls` (the shutter row) is `position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 10`, with `paddingBottom: insets.bottom + 16` applied inline. `styles.shutter` is a 72×72 circle; `styles.shutterArmed` adds the gold `#FFD60A` border/glow.
- `client/camera/components/ProductChip.tsx` — `styles.chip` is _also_ `position: "absolute", bottom: 0, left: 0, right: 0` with no `zIndex` set (defaults to 0), plus inline `paddingBottom: 20 + insets.bottom`.
- Both containers are identical full-width rectangles pinned to the screen bottom with zero vertical offset between them. `ScanScreen`'s shutter row explicitly sets `zIndex: 10`, so despite `ProductChip` mounting later in JSX, the shutter stacks visually above the chip's content wherever they overlap.
- Likely fix shape: give `ProductChip` a `bottom` offset equal to (or greater than) the shutter row's effective height (72px shutter + its `paddingBottom`), so the chip renders entirely above the shutter row instead of behind it — mirroring how `ZoomLabel.tsx` already does this (`bottom: 92 // px — clears the 72px shutter + insets.bottom padding below it`, from the same overhaul). Alternatively/additionally, reconsider whether `ProductChip` needs `position: absolute` at all versus being laid out in-flow above a fixed-height bottom controls row.

## Dependencies

- None known

## Risks

- `ProductChip` currently likely relies on `bottom: 0` to anchor itself flush with the screen edge in some phases (e.g. `session_complete`, which may not show a shutter) — verify the fix doesn't break those non-overlapping phases by mechanically applying an offset that isn't relevant to a phase where the shutter is hidden
- Multiple device sizes (iPhone SE through Pro Max) and safe-area insets must be re-checked — this is exactly the kind of layout issue that's easy to fix for one screen size and break for another

## Updates

### 2026-07-14

- Filed after user testing surfaced the overlap during scan-camera-overhaul on-device verification; root cause traced via code research, not yet fixed
