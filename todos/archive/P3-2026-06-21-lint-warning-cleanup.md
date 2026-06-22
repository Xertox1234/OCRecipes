<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "Clear pre-existing ESLint warn-level findings surfaced in CI"
status: done
priority: low
created: 2026-06-21
updated: 2026-06-21
assignee:
labels: [deferred, code-quality]
github_issue:

---

# Clear pre-existing ESLint warn-level findings surfaced in CI

## Summary

A handful of `warn`-level ESLint findings (unused imports, a `require()`-style
import in a test, and one `react-hooks/exhaustive-deps` warning) show up as
annotations on the `Lint · Types · Patterns` CI job. They don't fail the build
(warn, not error) but they're noise on every run.

## Background

Surfaced incidentally while watching the `main` CI run for `af4468a3` (the
harness-commit push) on 2026-06-21. They are **pre-existing** — none were
introduced by that push; they live in client/eval files untouched by it. Filed
as a low-severity cleanup per the repo's auto-file rule for minor followups.

## Acceptance Criteria

- [ ] `evals/judge.ts:1` — remove unused `judgeGeneric` (or export/use it if intended)
- [ ] `client/screens/ScanScreen.tsx:79` — remove unused `ContentType`
- [ ] `client/components/home/CuratedRecipeCarousel.tsx:17` — remove unused `CARD_WIDTH`
- [ ] `client/components/TastePicksGrid.tsx:6` — remove unused `withOpacity`
- [ ] `client/camera/components/__tests__/CoachHint-utils.test.ts:3` — remove unused `ScanPhase`
- [ ] `client/camera/components/__tests__/CameraView.test.tsx:22` — replace `require()`-style import with an ESM import
- [ ] `client/camera/components/ProductChip.tsx:83` — resolve the `useEffect` missing-dep (`translateY`) **by verification, not blind suppression** (see notes)
- [ ] `Lint · Types · Patterns` CI job emits no warn annotations for these

## Implementation Notes

- The unused-import and `require()`-style items are mechanical deletions/rewrites.
- **`translateY` exhaustive-deps needs judgment, not a reflex fix.** Read
  `ProductChip.tsx:83` first: if `translateY` is a Reanimated `SharedValue` (stable
  identity), the warning is a false positive and the right move is a scoped
  `eslint-disable-next-line react-hooks/exhaustive-deps` with a one-line reason —
  NOT adding it to the dep array (which can retrigger the effect). If it's a plain
  value/state, add the dep. Verify the animation behavior is unchanged either way.
- React Compiler is active, so do not "fix" anything by adding manual memoization.

## Dependencies

- None.

## Risks

- The `translateY` item is the only one with behavioral risk — a wrong fix could
  change the chip animation. Treat it as the careful one; the rest are noise.

## Updates

### 2026-06-21

- Initial creation — surfaced from the `main` CI annotations during the post-push
  watch of the harness commits (`af4468a3`). All findings pre-existing.
