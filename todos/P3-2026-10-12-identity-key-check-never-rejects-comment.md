---
title: 'Identity key boot check: the "never rejects" comment overstates it'
status: backlog
priority: low
created: 2026-10-12
updated: 2026-10-12
assignee:
labels: [deferred, security]
github_issue:
---

# Identity key boot check: the "never rejects" comment overstates it

## Summary

`runIdentityKeyBootCheck`'s docblock (`server/lib/social-identity/key-check.ts`) says "Never rejects: every outcome is a log line". But `loadIdentityKey(raw)` throws on a key that isn't 32 bytes. That throw surfaces as a rejection, which `fireAndForget` logs as a generic "background operation failed", with no fingerprint and no Sentry event.

It's unreachable today: `server/lib/env.ts` refuses to boot with a malformed `IDENTITY_TOKEN_ENC_KEY`. So only the comment is wrong.

## Background

A server-reviewer suggestion on the identity-key boot-check PR (head f112eb3a). It was filed rather than fixed, under the one-review-pass rule.

## Acceptance Criteria

- [ ] Either reword the docblock ("never rejects for a valid key; env.ts rejects a malformed one at boot"), or wrap `loadIdentityKey` so a malformed key logs `identity key check: could not run` and the function really never rejects.
- [ ] If wrapped: a test with a 16-byte key resolves and warns.

## Implementation Notes

- `server/lib/social-identity/key-check.ts` (`runIdentityKeyBootCheck`), plus `server/lib/social-identity/__tests__/key-check.test.ts`.
