<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "Scan screen shutter button visually overlaps ProductChip's caption text"
status: done
priority: medium
created: 2026-07-14
updated: 2026-07-15
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

- [x] The shutter button and the ProductChip's content (especially caption text in `barcode_lock`/`step2_confirmed`, and the review card in `step2_review`/`step3_review`) never visually overlap at any phase, on any tested device size — with one explicit, deliberate exception: `session_complete` keeps its pre-existing flush-bottom layout per the third acceptance-criteria bullet below, so it does not gain shutter clearance (see Updates)
- [x] Existing shutter tap target and armed-state styling (gold ring, glow) are unaffected — `client/screens/ScanScreen.tsx` was not modified
- [x] No regression to `ProductChip`'s existing layout/spacing for phases that don't render a caption (session_complete, etc.) — `session_complete`'s `bottom`/`paddingBottom` values are byte-for-byte identical to the pre-fix code

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

### 2026-07-15

- Implemented: extracted `getShutterClearanceStyle(variant, insetsBottom)` into `client/camera/components/ProductChip-utils.ts`. It returns `{ bottom: insetsBottom + 96, paddingBottom: 20 }` for every variant except `session_complete`, and `{ paddingBottom: 20 + insetsBottom }` (no `bottom` override — the pre-fix flush-bottom layout, unchanged) for `session_complete`, per this todo's third acceptance-criteria bullet. `ProductChip.tsx` calls this and applies the result to its root `Animated.View`'s style array. `client/screens/ScanScreen.tsx`'s shutter row (`styles.controls`) was confirmed to render unconditionally across every scan phase (no phase gate exists), so the phase-awareness is keyed off `ProductChip`'s own `variant` rather than a shutter-visibility condition. `ScanScreen.tsx` itself was not modified.
- First-pass implementation used a static `bottom: 92` (mirroring `ZoomLabel.tsx`'s existing pattern) — code review (2 rounds, `code-reviewer` + `mobile-reviewer`) found this didn't scale with `insets.bottom`, so on home-indicator devices (`insets.bottom ≈ 34`) the chip's own background box (not its text) still overlapped the shutter's vertical footprint by ~30px, and the chip's `paddingBottom: 20 + insets.bottom` double-counted the inset once the `bottom` offset itself absorbed it (dead whitespace below the last button/caption). Both fixed: `bottom` is now derived as `insets.bottom + 96` (constant 8px clearance above the shutter's top edge, `insets.bottom + 88`, on every device), and `paddingBottom` is a flat `20` for raised variants. The enter/exit spring's off-screen distance (`OFF_SCREEN_Y`) was also bumped from 200 to 400, since the raised resting position shrank the margin needed to keep the chip fully off-screen during its animation.
- Added test coverage: `getShutterClearanceStyle` unit tests (`ProductChip-utils.test.ts`) covering the raised/`session_complete` derivation across `insetsBottom` values, plus a wiring-seam test (`ProductChip.test.tsx`) asserting the component actually calls the function with the derived `variant` and `insets.bottom` — per `docs/solutions/conventions/pure-utils-extraction-tests-dont-prove-wiring-2026-07-14.md`, a pure-function test alone doesn't prove the component is wired to it correctly. Full suite: 6355/6355 passing (5 new).
- Environment constraint: no iOS Simulator camera and no dev-client build exist on this machine right now (deleted for disk space per project state). The acceptance criteria call for visual verification on the live camera view across device sizes, which cannot be performed in this environment. Type-check/lint/tests pass, confirming the code compiles and existing tests are unaffected — this does NOT constitute visual verification of the overlap fix. Deferred to the user's on-device OTA check.
- Known, accepted tradeoff (flagged by advisor + code review, not fixed — would require animating the offset through Reanimated, a larger change than this todo's scope): because `session_complete` is deliberately excluded from the raise, a transition from a raised variant (e.g. `step3_review`/`step2_confirmed`) directly into `session_complete` while the chip stays mounted causes an instant (non-animated) ~92-130px drop as the chip swaps to its "Done →" button. This is brief — `session_complete` is a transient phase that either auto-navigates away after ~700ms or gets covered by the `confirmCard` overlay — but it is a new, user-visible artifact worth an eyeball during on-device verification.
- Deferred (out of scope, not fixed): the `92`/`96`-shaped shutter-clearance magic number is now derived independently in `ProductChip-utils.ts` and still duplicated as a separate static `92` in `ZoomLabel.tsx` (unmodified) — a future change to the shutter's size or padding in `ScanScreen.tsx` could desync the two. Consolidating into a shared constant would touch a third file and was judged out of this todo's minimal-change scope.
