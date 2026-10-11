---
title: "Per-account /social/link guess limit should survive deploys"
status: backlog
priority: low
created: 2026-10-11
updated: 2026-10-11
assignee:
labels: [deferred, security]
github_issue:
---

# Per-account /social/link guess limit should survive deploys

## Summary

The per-account limiter on password guesses through /api/auth/social/link is an in-memory express-rate-limit store, reset on every deploy, though the code names it the real bound.

## Background

Auth audit 2026-10-10 L15 (research: better-fix). express-rate-limit 8.5.2 docs: MemoryStore resets on restart; use an external store. `docs/solutions/conventions/security-caps-must-be-durable-and-say-which-window-2026-10-03.md`. Hard precondition (needs a link_required ticket for the victim), hence Low.

Source: auth security audit 2026-10-10 (manifest `docs/audits/2026-10-10-security.md`, local-only); deferred at owner triage 2026-10-11.

## Acceptance Criteria

- [ ] Failed link attempts per target user are counted durably in Postgres (a small counter + window on the target, or a Postgres rate-limit store) and checked atomically
- [ ] Test proves the cap holds across a simulated restart (fresh module import)

## Implementation Notes

- `server/routes/_rate-limiters.ts:474-500`, `server/routes/auth-social.ts:64-70,537`
- Likely needs a migration — take the next free number (password policy PR 2 also wants one).

## Scope Contract

- **Mechanisms to use:** existing patterns in the files below — nothing new beyond what an acceptance criterion needs
- **Files in scope:** `server/routes/_rate-limiters.ts`, `server/routes/auth-social.ts`, `server/storage/`, `migrations/`, `shared/schema.ts`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- Auth code: never delegate to cheap workers; review with security-auditor.

## Updates

### 2026-10-11

- Initial creation (deferred from the auth security audit)
