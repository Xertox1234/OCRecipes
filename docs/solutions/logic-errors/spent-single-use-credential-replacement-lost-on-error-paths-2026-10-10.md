---
title: "A spent single-use credential's replacement must ride every later response — error paths and dismissals lost it"
track: bug
category: logic-errors
tags: [security, api, react-native]
module: server
applies_to: ["server/routes/auth*.ts", "server/lib/mfa/**", "client/components/*Modal.tsx", "client/screens/TwoStep*.tsx"]
symptoms: ["A recovery code is used, the request then fails (409, 401, 500), and the error body has no replacementRecoveryCode", "A replacement-code card can be closed by Cancel, a backdrop tap or Android back before 'I've saved it'", "The person ends up with fewer usable recovery codes than they think, with no error anywhere"]
created: 2026-10-10
last_updated: 2026-10-11
severity: medium
---

# A spent single-use credential's replacement must ride every later response — error paths and dismissals lost it

## Problem

Using a recovery code deletes it and stores a replacement in the same transaction (spec §3.2). The replacement is shown **once**. Two layers dropped it:

- **Server (#1355, found by all three reviewers):** connect-a-sign-in-method, change email and new phone attached the replacement only to the success JSON. A bad provider token, `IDENTITY_IN_USE`, an email collision or a 500 after the gate returned plain `sendError` / `handleRouteError` bodies. New phone also spent the code **before** checking that the encryption key existed, then answered 503.
- **Client (#1357, found by the mobile, code and security reviewers):**
  - The change-email and connect modals showed the card, but Cancel, a backdrop tap and Android back still closed them.
  - Change email also left "Update email" live, so a finished change could be resubmitted with the spent code.
  - The new-phone screen never read the replacement off a failed response.

## Root Cause

The credential is consumed **mid-request**. Every exit after that point carries the obligation to hand back the replacement, but the existing helpers (`sendError(res, status, msg, code)`, `handleRouteError`) and the modal close paths had no way to carry it.

## Solution

- **Server (#1356):**
  - Hoist `let replacement = {}` above the `try` and fill it once the gate passes.
  - Pass it as a new optional `extra` to `sendError` / `handleRouteError`. It's spread **before** `error`/`code` so it can't overwrite them.
  - Put the cheap precondition (`requireConfigured()`) **before** the step that spends the credential.
- **Client (#1358):**
  - While the card is showing, every close path is a no-op (`if (busy || replacement) return`), so "I've saved it" is the only way out.
  - The form's submit buttons are hidden while the card shows.
  - Every catch calls `replacementFromError(err)`, which reads it from the `${status}: ${body}` `ApiError` message.

### Better still: refuse before the spend (#1391)

Handing the replacement back is the fallback. The stronger rule is that a
request which is going to be refused for a reason that needs no credential must
be refused **before** the credential is touched. Change password ran
proof → second factor → new-password policy, so a breached new password (the
only refusal left on a two-step account once the schema's 8-character floor
passes) spent the recovery code, and the person had to save a replacement just
to retry. Their VoiceOver also heard the error cut off the new code. #1391 moved
`checkNewPassword` to right after the account load, ahead of the proof and the
factor, matching `/mfa/disable`. That also stopped it costing an emailed-code
attempt (`reservePasswordChangeAttempt`).

It is safe to run before the proof: the check reads only the candidate password
and whether two-step is on (already visible to the session via `/me`), and
`reauthLimiter` bounds the breach-list lookups.

## Prevention

For any endpoint that consumes a single-use credential (a recovery code, an emailed-code attempt), first move every refusal that needs no credential (preconditions, new-password policy and breach check) ahead of the consume point, and test it with the factor mock asserting `not.toHaveBeenCalled()`. Then list **every** response after the consume point (each `return`, each `throw` that reaches the catch, and the 500) and check that each one carries the replacement. In the UI, test the close paths, not only the happy path.

## Related Files

- `server/lib/api-errors.ts`, `server/routes/_helpers.ts`, `server/routes/auth.ts`, `server/routes/auth-social.ts`, `server/routes/auth-mfa.ts`, `server/routes/auth-password.ts` (policy before proof, #1391)
- `client/lib/second-factor-utils.ts` (`replacementFromError`), `client/components/ReplacementCodeCard.tsx`, `client/components/ChangeEmailModal.tsx`, `client/components/PasswordConfirmModal.tsx`, `client/screens/TwoStepSetupScreen.tsx`

## See Also

- [Password proofs need the second factor](../conventions/password-proof-needs-second-factor-after-the-password-check-2026-10-10.md) — the gate that spends the code
- [Two announceForAccessibility calls in one commit collide on iOS](two-announceforaccessibility-same-commit-collide-ios-2026-07-21.md) — the card + error VoiceOver collision a spent code caused
