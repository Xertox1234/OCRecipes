---
title: "A verified email proves the inbox, not who chose the password — never auto-link a provider sign-in into an account that has a password"
track: bug
category: logic-errors
tags: [security, api]
module: server
applies_to: ["server/lib/social-identity/**", "server/routes/auth-social.ts", "server/routes/auth.ts"]
symptoms: ["Sign in with Apple/Google silently lands in an existing account the person never set a password for", "A squatter who registered the victim's email keeps password access to the account the victim now uses", "An Apple ID on an address that later changed hands signs straight into the new owner's account"]
created: 2026-10-11
severity: high
---

# A verified email proves the inbox, not who chose the password — never auto-link a provider sign-in into an account that has a password

## Problem

`decideLink` auto-linked a Google/Apple sign-in into an existing account whenever the account's email was verified, it had no second factor, the provider's email matched, and the provider was "authoritative" for that address. Two takeovers followed (auth audit 2026-10-10 H1):

1. **Squatter:** the attacker registers `victim@x` with their own password. Re-registering an unverified email re-sends a link that verifies the EXISTING account — the victim clicks "finish setting up" (or a mail scanner prefetches the GET link) and verifies the attacker's account. The victim's later Apple/Google sign-in auto-links into it; the attacker still holds the password.
2. **Address changed hands:** Apple was treated as authoritative for any non-relay verified email, but Apple's `email_verified` only means "verified when the Apple ID was created" — the same staleness Google's own guide warns about for non-gmail addresses. An Apple ID on an address that later passed to the victim auto-linked into the victim's account with no victim action.

## Symptoms

- A provider sign-in "just works" into an account whose password someone else set.
- After the victim's password reset, nothing changes for a password the attacker never needed.

## Root Cause

Email verification is a statement about the **inbox**, made at some past moment. Auto-link treated it as proof that the provider user owns the **account** — including its password, which was chosen by whoever registered it. Google ("Verify the Google ID token": "password or other challenge methods are recommended") and OIDC Core §5.7 (email is not a stable identifier) both say not to merge on email alone.

## Solution

One predicate in the single linking decision (`server/lib/social-identity/linking-policy.ts`): an account whose sign-in methods include `password` is never `auto_link` — it gets `link_required`, i.e. the person proves the password (plus the code on a 2FA account). Password-less (social-only) accounts still auto-link (owner ruling 2026-10-11; Apple onto a Google-only account is an accepted residual pinned in a test).

Tests: each `decideLink` condition has a case that fails only on that condition — mutation-checked (removing `emailVerified`, `sameAddress` or `isAuthoritative` breaks a test). The H1 password check initially made four older tests pass on their own; their fixtures were switched to password-less accounts.

## Prevention

- Any rule that attaches a credential to an existing account must require proof of THAT account (its password / an already-linked provider / a session), never a property of an email address.
- When adding a gate to a multi-conjunct decision, re-check that every existing test still isolates the conjunct it names.

## Related Files

- `server/lib/social-identity/linking-policy.ts` — `decideLink`
- `server/routes/auth-social.ts` — the `auto_link` and `link_required` branches
- `server/routes/auth.ts` — re-register branch sends a Forgot-password notice, not a verify link (M4); remaining verify paths: `todos/P2-2026-10-11-auth-reregister-verifies-squatter-account.md`. Its send budget: [attacker-triggered-mail-sharing-the-recovery-budget-starves-recovery](attacker-triggered-mail-sharing-the-recovery-budget-starves-recovery-2026-10-11.md)

## See Also

- [password-reset-must-cancel-stateless-identity-credentials](../conventions/password-reset-must-cancel-stateless-identity-credentials-2026-10-03.md) — who holds a credential vs who proved the inbox
