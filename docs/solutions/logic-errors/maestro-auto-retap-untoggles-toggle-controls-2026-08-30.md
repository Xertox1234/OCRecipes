---
title: Maestro's default retryTapIfNoChange re-taps toggles back off — disable it on any toggle-shaped control
track: bug
category: logic-errors
tags: [testing, react-native, maestro, e2e]
module: client
applies_to: ["e2e/**"]
symptoms: ["a toggle tap reports COMPLETED but the UI stays (or returns to) the pre-tap state — intermittently", "a checkbox is unchecked after its tap 'succeeded'"]
created: 2026-08-30
severity: medium
---

# Maestro's default retryTapIfNoChange re-taps toggles back off — disable it on any toggle-shaped control

## Problem

`tapOn: "Switch to sign up"` intermittently left the form in sign-in mode,
and the COPPA checkbox sometimes ended unchecked, despite COMPLETED taps.

## Symptoms

See frontmatter. Intermittency is the tell — the same tap works on runs where
Maestro's change-detection catches the first tap in time.

## Root Cause

`tapOn` defaults to `retryTapIfNoChange: true`: if Maestro doesn't observe a
hierarchy change quickly enough, it taps AGAIN. On idempotent buttons that's
harmless; on a toggle the second tap reverts the first. Slow re-renders
(mode-switch re-flashing the splash overlay) widen the race window.

## Solution

Set `retryTapIfNoChange: false` on every toggle-shaped tap: mode switches,
checkboxes, switches, segmented controls, show/hide affordances.

## Prevention

Reviewing a flow: any `tapOn` whose target flips state (rather than
navigating or submitting) needs the flag. Grep candidates: `Switch to`,
`checkbox`, `toggle`, `Show password`.

## Related Files

- `e2e/flows/auth/login.yaml`, `e2e/flows/onboarding/complete-onboarding.yaml`

## See Also

- [maestro-text-matching-is-full-string-regex](maestro-text-matching-is-full-string-regex-2026-08-30.md) — companion Maestro-semantics trap from the same commissioning effort
