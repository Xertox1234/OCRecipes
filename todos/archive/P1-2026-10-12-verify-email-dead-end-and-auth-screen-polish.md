---
title: "Verify-email expired link is a dead end; signed-in verify link does nothing; auth screen polish"
status: done
priority: high
created: 2026-10-12
updated: 2026-10-16
assignee:
labels: [qa-sweep, auth, ui]
github_issue:
---

# Verify-email expired link is a dead end; signed-in verify link does nothing

## Summary

A signed-out user who opens an expired or invalid verification link gets a screen with no way back to sign in; a signed-in user who taps the link gets nothing. Fix both, plus the small auth-screen issues the 2026-10 visual QA sweep found.

## Background

Report `docs/audits/2026-10-11-visual-qa-sweep.md` (gitignored, local), groups C, G, H, I; screenshots `~/qa-sweep-2026-10/auth/`. Auth is high-risk in this repo (see the auth memories) — do this in its own session, not delegated.

- **#74 High.** `ocrecipes://verify-email?token=bogus` while signed out → "Link expired or invalid" + email field + "Resend verification email". The failed branch has no "Back to sign in" (the confirmed and sent branches do: `client/screens/VerifyEmailScreen.tsx:113`, `:186`); route `headerShown: false` (`client/navigation/RootStackNavigator.tsx:279-281`); edge-swipe does nothing → force-quit is the only exit. Failed branch: `VerifyEmailScreen.tsx:118-140`. Its email field has no accessibility label (S2, confirmed at runtime; also `:125`, `:152`).
- **#55 Medium (confirm intended flow first).** The same link while signed in → no `VerifyEmail` route in the signed-in stack; dev shows "The action 'NAVIGATE' … was not handled", production is silent. A user who just signed up and taps the email link gets no response. `client/navigation/linking.ts:268`, `RootStackNavigator.tsx`.
- Lows folded in:
  - #43 Login/Sign-up status bar is dark-content over the dark hero photo.
  - #44 Field error border terracotta on Login but red on Forgot Password; Forgot Password keeps its error after the email is fixed.
  - #45 Leaving Login after a failed attempt makes iOS offer to save the wrong password.
  - #72 ChangePassword: an empty submit's 400 validation shows "Something went wrong"; placeholders are the only labels. `client/screens/ChangePasswordScreen.tsx`.
  - #79 2FA: recovery codes in proportional Poppins (O/0, I/l ambiguity — use a monospace face); two stacked filled primaries on the key step; success toast covers the header. `client/screens/TwoStepSetupScreen.tsx`.

## Acceptance Criteria

- [ ] Every VerifyEmail state (confirming, confirmed, failed, sent) has a visible way back to sign in.
- [ ] Owner confirms the signed-in behaviour for #55, then the link does that (e.g. confirm + toast, or open a confirm screen); no unhandled NAVIGATE.
- [ ] VerifyEmail inputs have accessibility labels.
- [ ] #43, #44, #45, #72, #79 fixed or explicitly declined.
- [ ] Tests for any changed navigation/linking logic; manual check signed out and signed in.

## Implementation Notes

- Verify links act only on a POST from a confirm button (see the solution doc on emailed links clicked by mail scanners) — keep that.
- Local two-step testing needs no extra variables: since #1410 two-step is an emailed code only, and `MFA_SETUP_ENABLED` / `MFA_SECRET_ENC_KEY` are gone (test account `qasweep1` had authenticator 2FA, which migration 0025 removed).

## Scope Contract

- **Mechanisms to use:** existing navigation/linking config and screens.
- **Files in scope:** `client/screens/VerifyEmailScreen.tsx`, `client/navigation/linking.ts`, `client/navigation/RootStackNavigator.tsx`, `client/screens/LoginScreen.tsx`, `client/screens/ForgotPasswordScreen.tsx`, `client/screens/ChangePasswordScreen.tsx`, `client/screens/TwoStepSetupScreen.tsx`, their `__tests__`.
- No changes to server auth logic unless #55's chosen flow requires it — flag that in the PR.

## Dependencies

- Owner decision on #55's signed-in flow.

## Risks

- Auth has a history of recurring breakage; route tests mock the middleware — verify end to end on the simulator.

## Updates

### 2026-10-12

- Filed from the visual QA sweep triage.

### 2026-10-16

- Done via /todo-fast (in-session, auth not delegated). Owner ruling for #55: a signed-in link opens the same VerifyEmail screen as a modal; Done returns to the app.
- #74, #55, a11y labels, #43, #44 (stale error), #45, #72 fixed. Declined: #44's colour difference (Login's terracotta is the focus border, not an error state); #79's monospace codes and stacked primaries (obsolete since #1410) and toast-over-header (app-wide by design, no offset option). Fixed instead: #79's double buzz and double VoiceOver line.
- Simulator-checked signed in (bogus + real token) and signed out (bogus token). #45's iOS save prompt needs iCloud Keychain, so it is unit-tested only.
