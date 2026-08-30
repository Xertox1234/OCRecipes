---
title: iOS-26-simulator secureTextEntry fields swallow synthetic input — enter passwords through the app's Show-password toggle
track: bug
category: logic-errors
tags: [testing, react-native, maestro, e2e, ios]
module: client
applies_to: ["e2e/**", "client/screens/LoginScreen.tsx"]
symptoms: ["secure field holds exactly ONE character after a full inputText or pasteText (single • in the hierarchy value)", "submit fails 'at least 8 characters' though the flow entered a full password", "plain fields in the same form receive full text — only secure fields truncate", "one password field full while the sibling confirm field is EMPTY (keyboard-covered focus tap)"]
created: 2026-08-30
severity: high
---

# iOS-26-simulator secureTextEntry fields swallow synthetic input — enter passwords through the app's Show-password toggle

## Problem

The register flow's password fields ended with one character each on iOS
26.x simulators (local 26.5 and CI 26.x alike), across THREE mechanisms:
`inputText`, erase-and-retype, and `setClipboard`+`pasteText` (three rounds
of it, every command "COMPLETED"). The register could never submit.

## Symptoms

See frontmatter — the one-`•` field value in a failure hierarchy dump is the
signature. Non-secure fields typing perfectly in the same run rules out
focus/keyboard/network explanations.

## Root Cause

Maestro's iOS driver synthesizes keyboard input (its `pasteText` degrades to
the same path), and iOS 26 simulators drop synthesized input into
`secureTextEntry` fields — one character survives. This is environmental,
deterministic, and mechanism-independent; no amount of retrying the same
input class fixes it. (XCUITest's element-level `typeText` — a different
input path — works, which is why interactive tooling can mislead you here.)

Two secondary traps compounded diagnosis:

- The invisible **"Use Strong Password?" AutoFill sheet** attaches to secure
  fields and never appears in Maestro's hierarchy, initially masquerading as
  the cause.
- With the keyboard raised, the **confirm field can sit under the keyboard**:
  the focus tap "completes" without moving focus and the confirm text lands
  in the still-focused password field (observed: password full, confirm
  empty). Blur first (tap static header text — NOT `hideKeyboard`, whose iOS
  implementation can background the app entirely), then focus the next field.

## Solution

Flip the fields to plain text with the app's own **Show-password toggle**
(`LoginScreen`'s single `showPassword` state covers password AND confirm),
then `inputText` normally. A non-secure field types reliably — and never
attracts the AutoFill sheets in the first place. A visible test credential in
CI screenshots is harmless. Belt-and-braces: keep an outcome-oracle retry
(`repeat` `while: notVisible: <post-submit marker>`, bounded, all-optional
inner steps) so any residual one-off swallow self-heals.

## Prevention

Any new flow that fills a secure field on iOS must either use a
show-password affordance or justify why not. If a form lacks one, that is a
UX gap to surface — not a reason to fight synthesized-input mechanics again.

## Related Files

- `e2e/flows/onboarding/complete-onboarding.yaml` — the full pattern (toggle,
  blur-before-focus, oracle retry)
- `client/screens/LoginScreen.tsx` — the shared `showPassword` state

## See Also

- [maestro-text-matching-is-full-string-regex](maestro-text-matching-is-full-string-regex-2026-08-30.md) — the companion selector trap
- [ios-system-dialogs-replace-the-a11y-hierarchy](ios-system-dialogs-replace-the-a11y-hierarchy-2026-08-30.md) — the Save-Password cousin that IS visible in-test
