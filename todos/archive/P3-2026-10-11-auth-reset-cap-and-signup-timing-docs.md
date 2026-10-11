---
title: "Document two accepted auth risks: indefinite reset lockout and a sign-up timing sliver"
status: done
priority: low
created: 2026-10-11
updated: 2026-10-11
assignee:
labels: [deferred, security]
github_issue:
---

# Document two accepted auth risks: indefinite reset lockout and a sign-up timing sliver

## Summary

Record two accepted risks accurately: the reset-code cap can keep a victim out of email recovery indefinitely (not "up to 24 h"), and the sign-up new-email path awaits one extra INSERT.

## Background

Auth audit 2026-10-10 L5 + L6. L5: ~6 forgot-password requests per window (3/h per-email limiter, rotating IPs) exhaust the daily cap every day, and 5 wrong guesses kill any issued code — the 2026-10-03 spec says 24 h. L6: the new-email sign-up branch awaits createUser (1-5 ms) vs the taken branch's single SELECT; swamped by HIBP jitter and 5/h/IP.

Source: auth security audit 2026-10-10 (manifest `docs/audits/2026-10-10-security.md`, local-only); deferred at owner triage 2026-10-11.

## Acceptance Criteria

- [x] The password-reset spec / runbook states the lockout is indefinite while the attacker keeps going (victim still sees the code emails)
- [x] A one-line accepted-risk note for the sign-up timing difference sits beside the anti-enumeration comment in `server/routes/auth.ts`
- [x] Optional follow-up decision recorded: whether a reset started from a signed-in session or a verified social sign-in may bypass the cap

## Implementation Notes

- `server/storage/password-reset.ts:36-100`, `server/routes/auth.ts:239-282`
- Docs only unless the owner opts into the bypass.

## Scope Contract

- **Mechanisms to use:** existing patterns in the files below — nothing new beyond what an acceptance criterion needs
- **Files in scope:** `server/routes/auth.ts`, `docs/runbooks/`, `docs/solutions/`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- Auth code: never delegate to cheap workers; review with security-auditor.

## Updates

### 2026-10-11

- Initial creation (deferred from the auth security audit)

- Done: new tracked runbook docs/runbooks/password-reset-lockout.md (the window is FIXED from the first code, not rolling as this todo said; indefinite lockout while the attacker re-exhausts each window, how support tells the cases apart, what helps). The local-only spec (docs/superpowers/specs/2026-10-03-password-reset-design.md, gitignored) §8 corrected in the main checkout to match. L6 accepted-residual comment beside the register anti-enumeration branch. Cap-bypass decision recorded as OPEN for the owner in the runbook (not built; no signed-in password route exists).
