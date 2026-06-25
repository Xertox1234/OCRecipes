<!-- Filename: P2-2026-06-24-smart-confirm-reset-no-user-feedback.md  (P0=critical … P3=low) -->

---

title: "Smart-confirm reset paths give no feedback (any user) — route premium gate to UpgradeModal, unrecognised type to SMART_ERROR"
status: backlog
priority: medium
created: 2026-06-24
updated: 2026-06-24
assignee:
labels: [deferred, rn-ui-ux, accessibility, camera]
github_issue:

---

# Smart-confirm reset paths are a silent dead-end for ALL users

## Summary

When a smart-scan confirm starts (chip announces `"Analyzing photo…"`) but the
on-device resolution lands on a **reset** outcome, the chip silently disappears
with **no feedback of any kind** — no toast, no modal, no navigation. The
`reset` branch does exactly one thing: `dispatch({ type: "RESET" })`
(`ScanScreen.tsx:691-693`). This is **not** a screen-reader-only gap (its
original framing): a sighted user who taps **"Looks right →"** on a gated menu
scan watches the chip vanish with no explanation too. It was surfaced by an a11y
review, but the underlying defect is "the confirm produces zero feedback for
anyone."

Two distinct reset outcomes, each with a **different correct fix** (decided
2026-06-24 — see Updates):

1. **Premium gate blocked** (`menuScanner` / `cookAndTrack` / `receiptScanner`) →
   show **`UpgradeModal`**, matching the rest of the app.
2. **Unrecognised content type** (`non_food`, or `has_barcode` with no barcode) →
   dispatch to the existing **`SMART_ERROR`** phase (visible "Try again" chip).

## Background

Surfaced by the `code-reviewer` + `accessibility-specialist` review of PR #446
(the ProductChip announce-model rework). **Pre-existing**, not introduced by that
PR — the old container live region didn't cleanly announce this either (its
busy→idle re-read was the bug PR #446 removed). PR #446 left the busy→idle clear
intentionally silent and documented this gap in a code comment
(`ProductChip.tsx:119-121`, the "tracked separately" note); this todo tracks
closing it. Re-scoped 2026-06-24 from a11y-only to all-users after confirming the
reset branch shows nothing to anyone.

Trace (verified against code):

- `client/screens/ScanScreen.tsx` `onSmartPhotoConfirm` (~659-698): sets
  `isSmartConfirming(true)`, awaits `resolveSmartConfirmAction`, clears the flag
  in a `finally` (~695-698) on **all** outcomes. The `reset` branch (~691-693) is
  bare `dispatch({ type: "RESET" })`.
- `client/screens/scan-screen-utils.ts` `resolveSmartConfirmAction` (~138-182)
  returns `{ kind: "reset" }` on two **user-present** paths:
  1. premium gate blocked — `gate && !features[gate.feature]` (~165-167)
  2. `getRouteForContentType` returns `null` (~181) — `non_food`, or `has_barcode`
     without a barcode.
- On `reset`, `RESET` → phase `IDLE` → ProductChip variant `null` → chip hides.
  Both the variant→null transition and the busy→idle clear are silent by design,
  so nothing tells the user the confirm failed.
- The `navigate` outcome is fine (the destination screen announces itself); the
  `abort` outcome is fine (the user already left the screen).

### Why these two fixes (the decision)

- **Premium gate → `UpgradeModal` is the app-wide convention.** Every other gated
  surface shows it: `HomeScreen`, `HistoryScreen`, `SettingsScreen`,
  `ProfileScreen`, and two **scan-flow** screens — `PhotoIntentScreen.tsx:122`
  and `ReceiptCaptureScreen.tsx:225` (`<UpgradeModal visible={true}
onClose={() => navigation.goBack()} />`, on the _same_ `receiptScanner` gate).
  Smart-confirm is the lone surface that diverged into a silent reset.
  `UpgradeModal` is already accessible (it's a `Modal` with its own announce), so
  the screen-reader cue comes for free, and a free user tapping "analyze this
  menu" is the ideal upsell moment. ("Try again" would be the _wrong_ CTA here —
  retrying never grants a subscription, which is why this path can't reuse
  `SMART_ERROR`.)
- **Unrecognised type → reuse `SMART_ERROR`.** That phase already renders a
  visible _"Couldn't identify this. Try again?"_ chip (`ProductChip.tsx:312`) and
  is announced on both platforms by the PR #446 variant-keyed
  `announceForAccessibility` effect (`ProductChip.tsx:99`). "Try again" is the
  right CTA — a re-scan can succeed. Dispatching into `SMART_ERROR` gets visible +
  spoken feedback for free, which is cleaner than the originally-suggested
  `onSmartPhotoConfirmFailed` callback (that would hand-rebuild what the
  reducer+effect already produce).

## Acceptance Criteria

- [ ] **Premium-gate path** shows `UpgradeModal` (consistent with
      `PhotoIntentScreen` / `ReceiptCaptureScreen`). Closing the modal returns the
      user to the camera (`dispatch RESET` on close). A screen-reader user hears
      the modal; a sighted user sees it — no silent chip vanish.
- [ ] **Unrecognised-content path** shows the existing `SMART_ERROR` chip
      ("Couldn't identify this. Try again?"), which is both visible AND announced
      on iOS + Android via the PR #446 variant effect.
- [ ] The `navigate` outcome is unchanged — no failure cue (the new screen's own
      announcement stands).
- [ ] The `abort` outcome (user navigated away during OCR) stays silent.
- [ ] Remove the "tracked separately" comment in the `ProductChip` busy effect
      (`ProductChip.tsx:119-121`) — the busy→idle clear stays silent, which is now
      correct because every outcome has its own feedback.
- [ ] Verify on the Android emulator with TalkBack (composed speech via `logcat`,
      per `docs/solutions/best-practices/verify-talkback-behavior-via-emulator-logcat-2026-06-23.md`)
      and reason through the iOS VoiceOver path. Verify a **sighted** user gets
      feedback on both reset paths too.

## Implementation Notes

- **Surface the reason instead of inferring it.** `resolveSmartConfirmAction`
  already knows which reset path it took — replace the single `{ kind: "reset" }`
  with two explicit outcomes (or a `reason` discriminator), e.g.:
  ```ts
  export type SmartConfirmAction =
    | { kind: "navigate"; route: ClassificationRoute }
    | { kind: "blocked"; gate: { feature: PremiumFeatureKey; label: string } } // premium
    | { kind: "unrecognized" } // route null
    | { kind: "abort" };
  ```
  The premium branch (~165) returns `{ kind: "blocked", gate }`; the route-null
  branch (~181) returns `{ kind: "unrecognized" }`.
- **ScanScreen** (`onSmartPhotoConfirm` + render):
  - `blocked` → `setShowUpgradeModal(true)` (new `useState`); render
    `<UpgradeModal visible={showUpgradeModal} onClose={() => { setShowUpgradeModal(false); dispatch({ type: "RESET" }); }} />`.
    Note `UpgradeModal` takes only `visible` / `onClose` / `onUpgrade?` — it has
    no feature/label prop, so the copy is generic (matches every other call site).
  - `unrecognized` → `dispatch({ type: "SMART_CONFIRM_FAILED" })` (new action) →
    `SMART_ERROR`.
- **Reducer** (`client/camera/reducers/scan-phase-reducer.ts`): add a
  `SMART_CONFIRMED → SMART_ERROR` transition (e.g. action `SMART_CONFIRM_FAILED`)
  carrying `imageUri` forward. `SMART_ERROR` is `{ type, imageUri, error }`; the
  chip's visible text is hardcoded, so threading a specific `error` string is
  optional (check `getChipAnnounceText` reads acceptably for this case).
- **ProductChip**: remove the "tracked separately" comment in the busy effect
  once closed.
- **Touch points**: `scan-screen-utils.ts` (action union + the two return sites),
  `ScanScreen.tsx` (UpgradeModal state/render + reset-branch split),
  `scan-phase-reducer.ts` (new transition), `ProductChip.tsx` (comment removal).
- **Tests**: the `SmartConfirmAction` union change ripples to
  `client/screens/__tests__/scan-screen-utils.test.ts` (currently asserts
  `{ kind: "reset" }`); add a reducer test for the new transition.

## Dependencies

- Builds on PR #446 (MERGED). None blocking.

## Risks

- **Modal-over-camera-overlay focus**: the chip already toggles
  `importantForAccessibility="no-hide-descendants"` while the confirm overlay is
  up (iOS uses `accessibilityViewIsModal`). Confirm `UpgradeModal`'s own modal
  presentation interacts cleanly with the chip's focus handling — the chip should
  leave the a11y tree while the upgrade modal is presented. Per-outcome
  verification required so the announce never fires on `navigate`/`abort`.
- `SMART_ERROR` reuse: confirm `getChipAnnounceText(smart_error, phase)` reads
  acceptably for the unrecognised case (currently generic "couldn't identify").

## Related (flag, do NOT fix here)

- `shouldAutoRoute` (`scan-screen-utils.ts:185`) is exported and unit-tested but
  **unused in production** — every smart scan funnels through the confirm chip, so
  the premium gate only ever fires at confirm time. No inconsistency today, but if
  auto-routing is ever wired up, a high-confidence gated scan would bypass the
  gate. Worth a separate decision (delete the dead code, or wire auto-routing
  _with_ the gate) — out of scope for this todo.

## Updates

### 2026-06-24

- Created from the PR #446 review (code-reviewer + accessibility-specialist).
- Re-scoped + decided the same day (with the user): the gap is **silent for all
  users**, not a11y-only. Premium-gate reset → **`UpgradeModal`** (app-wide
  convention, decided over a lighter inline cue). Unrecognised-content reset →
  **`SMART_ERROR`** reuse. The two paths intentionally diverge (retry is wrong for
  a gate). Filed for later implementation; not a `/todo`-skill fit because the
  premium-vs-cue choice was a product/monetization decision an autonomous executor
  couldn't make. Renamed from `…-no-a11y-failure-cue` to `…-no-user-feedback`.
- **Implemented via `/plan`** (commit `e52b0114`, branch
  `fix/smart-confirm-reset-feedback`, **PR #447**). Done as specified: `blocked` →
  `UpgradeModal`, `unrecognized` → new `SMART_CONFIRM_FAILED` → `SMART_ERROR`,
  exhaustive `never`-guarded handler switch, "tracked separately" comment removed.
  Full `preflight` green; reviewed by `code-reviewer` (approve) +
  `accessibility-specialist` (sound). One design-comment accuracy fix from the a11y
  review (RESET-on-block is for not stranding an interactive chip behind the modal;
  RN `<Modal>`'s separate native window — not unmount ordering — is what prevents a
  nested `accessibilityViewIsModal`). Filed follow-up
  `P3-2026-06-24-upgrademodal-no-on-open-announce`.
- **STILL OPEN (do not archive / merge yet):** manual TalkBack + VoiceOver device
  pass (AC's last box) — needs a physical camera to drive the live scan, so the
  simulator can't cover it.
