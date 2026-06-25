<!-- Filename: P3-2026-06-24-upgrademodal-no-on-open-announce.md  (P0=critical … P3=low) -->

---

title: "UpgradeModal has no on-open announce — first focused element is the close button, not its purpose"
status: backlog
priority: low
created: 2026-06-24
updated: 2026-06-24
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

- [ ] On open, a VoiceOver/TalkBack user hears the modal's purpose (e.g. the
      "Upgrade to Premium" heading or an equivalent announce), not just "Close
      upgrade modal".
- [ ] The fix lands in `UpgradeModal` itself so **all** call sites benefit (do not
      special-case ScanScreen).
- [ ] No double-announce: if an on-open `announceForAccessibility` is added, confirm
      it doesn't stack with the existing success/error announces or the title's
      live region. Follow `docs/rules/accessibility.md`.
- [ ] Verify on Android emulator (TalkBack via logcat, per
      `docs/solutions/best-practices/verify-talkback-behavior-via-emulator-logcat-2026-06-23.md`)
      and reason through iOS VoiceOver.

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
