---
title: "getProductChipVariant's default: clause swallows new ScanPhases"
status: backlog
priority: low
created: 2026-07-29
updated: 2026-07-29
assignee:
labels: [deferred, camera]
github_issue:
---

# getProductChipVariant's `default:` clause swallows new ScanPhases

## Summary

`getProductChipVariant` ends in `default: return null`, so any newly added
`ScanPhase` silently gets "no chip" instead of being a compile error. That is the
same shape that made `LABEL_PROMPTED` a dead-end on `feat/scan-flow-2-phase1`.
Current behaviour is correct; only the fall-through is the risk.

## Background

Deferred from the `feat/scan-flow-2-phase1` final fix wave (commit `753be22d`).

`LABEL_PROMPTED` shipped as a terminal dead-end because three hand-maintained
phase lists in `ScanScreen.onShutterPress` diverged from the reducer. That wave
replaced them with `getCapturePlan` in `client/screens/scan-screen-utils.ts`,
written as an **exhaustive switch with no `default`** precisely so a new
`ScanPhase` fails to compile rather than being silently dropped.

`getProductChipVariant` (`client/camera/components/ProductChip-utils.ts:112-135`)
was the fourth leg of that same dead-end: returning `null` for `LABEL_PROMPTED`
unmounts the chip, which took with it the ONLY dispatch sites for both
`PROCEED_TO_LABEL` and `CONFIRM_PRODUCT` (the barcode-only escape hatch). It
still uses `default: return null`.

Low severity, deliberately: the `null` for `LABEL_PROMPTED` is intentional and
documented (a collapsed chip is what "go frame the panel" means), and there is a
test covering it. Nothing is broken today. This is a latent-divergence guard, not
a defect — filed so the next phase addition can't repeat the pattern in a second
location.

## Acceptance Criteria

- [ ] `getProductChipVariant` switches exhaustively over every `ScanPhase["type"]`
      with no `default` clause, so an unhandled new phase is a `tsc` error
- [ ] Every phase that returns `null` today still returns `null` — no visible
      behaviour change (`LABEL_PROMPTED`, `IDLE`, `HUNTING`, `BARCODE_TRACKING`,
      `CLASSIFYING`)
- [ ] The existing `LABEL_PROMPTED → null` test still passes, and its comment is
      updated to say the `null` is now an explicit case rather than a fall-through
- [ ] `npx tsc --noEmit` clean; `ProductChip-utils` tests green

## Implementation Notes

- File in scope: `client/camera/components/ProductChip-utils.ts`
  (`getProductChipVariant`, roughly `:112-135`).
- Tests: `client/camera/components/__tests__/` — the file covering
  `getProductChipVariant` (grep for `LABEL_PROMPTED intentionally falls here`).
- Copy the shape from `getCapturePlan` in
  `client/screens/scan-screen-utils.ts` — it documents WHY there is no
  `default:`, and that comment is worth mirroring so a future refactor doesn't
  "tidy" the clause back in.
- The return type is `ProductChipVariant | null`, so the `null` cases must be
  listed explicitly (grouped `case` labels sharing one `return null`).
- While in the file, check whether any sibling phase-driven util in
  `client/camera/components/*-utils.ts` (`CoachHint-utils`, `StepPill-utils`,
  `ScanReticle-utils`) has the same `default:` fall-through — they were all
  touched by the same Phase-1 commit (`759ea8f2`). Fix them in the same pass ONLY
  if the change is a pure `default:` → explicit-cases rewrite with no behaviour
  change; otherwise note them and stop.

## Scope Contract

- **Mechanisms to use:** exhaustive `switch` with no `default` clause — nothing new.
- **Files in scope:** `client/camera/components/ProductChip-utils.ts`, its test
  file, and (only under the no-behaviour-change condition above)
  `client/camera/components/CoachHint-utils.ts`,
  `client/camera/components/StepPill-utils.ts`,
  `client/camera/components/ScanReticle-utils.ts` plus their tests.
- Do NOT change which variant any existing phase maps to.
- Do NOT touch `client/camera/` capture-path files (`CameraView*.tsx`,
  `useCameraFocusAndZoom.ts`, frame processors, barcode tracking).
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. `feat/scan-flow-2-phase1` should be merged first so the `getCapturePlan`
  precedent exists to copy from.

## Risks

- Low. A pure type-level tightening; the only way to get it wrong is to change a
  phase's mapping while listing the cases out, which the acceptance criteria pin.

## Updates

### 2026-07-29

- Initial creation. Deferred from the `feat/scan-flow-2-phase1` final fix wave
  (`753be22d`) — out of scope for that wave, which was closing the Critical.
