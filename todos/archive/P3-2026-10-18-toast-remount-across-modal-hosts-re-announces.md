---
title: "A toast live while a modal toast host mounts or unmounts remounts the Toast: second announcement, restarted dismiss timer"
status: done
priority: low
created: 2026-10-18
updated: 2026-10-18
assignee:
labels: [deferred, mobile, accessibility, toast]
github_issue:
---

# A toast live while a modal toast host mounts or unmounts remounts the Toast

## Summary

When a toast is already showing and a React Native `Modal` that carries `<ModalToastHost />` opens or closes, the toast moves to the other host. Moving it remounts the `Toast` component, so the screen reader hears the message a second time and the auto-dismiss timer starts over.

## Background

Deferred from PR #1503 (toasts over RN `Modal` sheets). The provider renders exactly one `Toast`, in the last-registered modal host or, with none mounted, in the root `FullWindowOverlay` host. Those are different React subtrees, so a host change is a remount, not a move. `Toast` announces in a mount effect and starts its dismiss timer in another, so both run again. The window is the toast's own lifetime (3 s, 5 s with an action, 10 s with an action under a screen reader), and it needs the user to open or close a sheet inside it, so it is rare. Documented as a known limit in `docs/solutions/design-patterns/toast-over-rn-modal-needs-a-modal-toast-host-2026-10-18.md`.

## Acceptance Criteria

- [x] A toast that moves between hosts mid-display is announced once per toast id, not once per mount (iOS imperative announce; the Android live region re-read on remount is unverified, Android runs parked).
- [x] The dismiss timer measures from the toast's creation, so a host change does not extend the toast's total visible time.
- [x] A test in `client/context/__tests__/` mounts a `ModalToastHost` mid-toast and asserts one announcement and an unchanged dismiss time.
- [x] The "Limit" paragraph of the solution doc is updated to describe the new behaviour.

## Implementation Notes

- Announcement: track the announced toast id in the provider (or pass `announced` state down) so `Toast`'s `announceForAccessibility` effect runs once per id. Alternative: move the announce call into the provider's `show` path, next to the haptic, and drop it from `Toast`. Check `client/components/__tests__/Toast.test.tsx` and `client/context/__tests__/ToastContext.test.tsx` for the single-announcement assertions that already exist.
- Timer: store `createdAt` on the queued toast and pass it to `Toast`; compute the remaining delay as `dismissMs - (Date.now() - createdAt)`, clamped at 0.
- The React Compiler compiles `ToastContext.tsx` since #1503 (its baseline entry was removed): no ref reads during render.

## Scope Contract

- **Mechanisms to use:** existing `ToastProvider` state and `Toast` props; nothing new.
- **Files in scope:** `client/context/ToastContext.tsx`, `client/components/Toast.tsx`, `client/context/__tests__/ToastContext.test.tsx`, `client/components/__tests__/Toast.test.tsx`, `docs/solutions/design-patterns/toast-over-rn-modal-needs-a-modal-toast-host-2026-10-18.md`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- A provider-level announcement must stay iOS-gated where the Android live region already covers the change (see `docs/rules/accessibility.md`, the double-announce family).

## Updates

### 2026-10-18

- Initial creation, deferred from PR #1503 and triaged with the owner.

### 2026-10-18 — orchestrator

- Done. The announcement moved from a `Toast` mount effect into `ToastProvider`'s `show` (still iOS-gated, next to the haptic), so it fires once per toast however many times the toast remounts. `show` stamps `createdAt` on the queued toast; `Toast` takes it as an optional prop and sets its dismiss timer to `dismissMs - (Date.now() - createdAt)`, clamped at 0, so a host change keeps the original deadline.
- Tests: `client/context/__tests__/ToastContext.test.tsx` asserts one announcement when a `ModalToastHost` mounts mid-toast and when one unmounts mid-toast, and (fake timers) that a toast shown at 0 s and moved into a host at 2 s is gone at 3 s. `client/components/__tests__/Toast.test.tsx` covers the `createdAt` prop directly, including the clamp. Red before the change (2 announcements; toast still visible at 3 s), green after. jsdom covers both criteria; no simulator run.
- The solution doc's "Limit" paragraph became a "Host change mid-toast" section; the remaining limit is the unverified Android live-region re-read on remount.
