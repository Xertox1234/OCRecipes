<!-- Filename: P3-2026-06-24-upgrademodal-no-on-open-announce.md  (P0=critical … P3=low) -->

---

title: "UpgradeModal has no on-open announce — first focused element is the close button, not its purpose"
status: done
priority: low
created: 2026-06-24
updated: 2026-06-25
assignee:
labels: [deferred, accessibility]
github_issue:

---

# UpgradeModal does not announce its purpose when it opens

## Summary

When `UpgradeModal` presents, the only screen-reader feedback is the OS focus
shift reading the modal's **first accessible element** — which is the close
`Pressable` ("Close upgrade modal"), not "Upgrade to Premium" or anything
conveying _why_ the modal appeared. A VoiceOver/TalkBack user hears "Close
upgrade modal" with no context about what was just gated.

## Background

Surfaced by the `accessibility-specialist` review of the smart-confirm-reset-feedback
change (commit `db028ae3`, PR for `todos/P2-2026-06-24-smart-confirm-reset-no-user-feedback`).
That change routes the premium-gate smart-confirm path to `UpgradeModal`, making
this the newest call site — but the gap is **pre-existing and cross-cutting**, shared
by every `UpgradeModal` consumer (`PhotoIntentScreen`, `ReceiptCaptureScreen`, plus
the Home/History/Settings/Profile gated surfaces). Not introduced by `db028ae3`;
explicitly flagged as out of scope for that commit.

Trace (`client/components/UpgradeModal.tsx`):

- `announceForAccessibility` is called only on the **success** (`~:64-66`) and
  **error** (`~:81-88`) IAP outcomes — never on open.
- The title's assertive live region is gated to `status === "success"` (`~:177-179`),
  so the "Upgrade to Premium" heading is not announced on open.
- The close `Pressable` ("Close upgrade modal", `~:134-137`) is the first accessible
  element, so it's what the focus-shift reads.

It is functional (the modal is fully navigable and the purpose is reachable by
swiping), so this is a polish-level a11y UX gap, not a blocker.

## Acceptance Criteria

- [x] On open, a VoiceOver/TalkBack user hears the modal's purpose (e.g. the
      "Upgrade to Premium" heading or an equivalent announce), not just "Close
      upgrade modal". — TalkBack speaks "Upgrade to Premium. Unlock the full
      OCRecipes experience." on open, and it lands BEFORE the close-button focus
      read (verified on-device, see Updates).
- [x] The fix lands in `UpgradeModal` itself so **all** call sites benefit (do not
      special-case ScanScreen). — single `useEffect` in `UpgradeModal.tsx`.
- [x] No double-announce: if an on-open `announceForAccessibility` is added, confirm
      it doesn't stack with the existing success/error announces or the title's
      live region. Follow `docs/rules/accessibility.md`. — exactly one
      `TYPE_ANNOUNCEMENT` per open edge on-device; the idle title carries no live
      region (gated to `success`), so announced on BOTH platforms with no iOS gate
      per `docs/rules/accessibility.md` line 17.
- [x] Verify on Android emulator (TalkBack via logcat, per
      `docs/solutions/best-practices/verify-talkback-behavior-via-emulator-logcat-2026-06-23.md`)
      and reason through iOS VoiceOver. — Android verified (logcat capture below);
      iOS reasoned (local build blocked) and the Android timing empirically backs
      the 500ms-delay rationale.

## Implementation Notes

- Likely a `useEffect` keyed on `visible` (false→true edge, prev-ref guarded so it
  doesn't fire on mount-while-hidden) calling `AccessibilityInfo.announceForAccessibility`
  with the modal's purpose. Alternatively, set the heading's assertive live region /
  initial focus so the OS reads the purpose first.
- Mind the platform-gate rules: if the heading already has a live region, don't add
  a second un-gated announce (Android double-announce). See the `accessibilityLiveRegion`
  / `busy` rules in `docs/rules/accessibility.md`.
- Touch point: `client/components/UpgradeModal.tsx` only.

## Dependencies

- None.

## Risks

- Double-announce if the new announce overlaps the existing success-path live region —
  gate carefully and verify on both platforms.

## Updates

### 2026-06-24

- Filed from the `accessibility-specialist` review of commit `db028ae3`. Pre-existing,
  cross-cutting; out of scope for the smart-confirm-reset fix. Worth a specific listen
  during that change's pending manual TalkBack/VoiceOver pass.

### 2026-06-25 — DONE

- **Implemented** in `client/components/UpgradeModal.tsx`: a `useEffect` keyed on
  `visible`, prev-ref edge-guarded for the `false→true` open edge (ref updated
  before the early return so it tracks every render), firing
  `AccessibilityInfo.announceForAccessibility("Upgrade to Premium. Unlock the full
OCRecipes experience.")` inside a 500ms `setTimeout` (cleaned up via the effect's
  return so a fast close cancels the pending announce). Announced on BOTH platforms
  with no iOS gate (idle title carries no live region). String is status-independent
  to survive the one-render async-`reset()` window where `state.status` is briefly
  `"error"` on reopen-after-error.
- **TDD**: tests added to `UpgradeModal.a11y.test.tsx` (RED→GREEN). Covers: announces
  on open (iOS + Android, no gate), no fire on mount-while-hidden, once-per-open +
  re-arm on full close→reopen, and no announce if closed before the 500ms delay
  elapses. 11/11 a11y tests pass; 42 UpgradeModal tests total pass.
- **Verified on Android emulator** (Medium*Phone_API_36.1, `google_apis_playstore`,
  TalkBack) via logcat per the verify-talkback-via-emulator-logcat solution, using a
  throwaway auto-advancing root-overlay harness (since reverted). On the `visible→true`
  edge TalkBack emitted a single `TYPE_ANNOUNCEMENT`
  `action=SPEAK text="Upgrade to Premium. Unlock the full OCRecipes experience."`
  ~583ms after the edge (matching the 500ms delay), \_then* the
  `TYPE_VIEW_ACCESSIBILITY_FOCUSED` "Close upgrade modal, Button" read — purpose leads,
  exactly one announce per open, no double-announce. Confirmed across two open cycles.
- **iOS**: reason-only (local iOS build blocked). The 500ms delay past the slide-present
  animation prevents VoiceOver swallowing the announce mid screen-change; the measured
  Android marker→announce gap empirically supports the delay choice.
- **Reviewed** by `accessibility-specialist` + `code-reviewer`: no Critical/High/Medium
  defects; the three Low test-coverage gaps they flagged were addressed in the test
  additions above.
