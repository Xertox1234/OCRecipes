<!-- Filename: P3-2026-07-07-contract-shape-regex-dedup.md -->

---

title: "Centralize duplicated UUID/email identifier regexes instead of inline copies in contract-shape.ts"
status: backlog
priority: low
created: 2026-07-07
updated: 2026-07-07
assignee:
labels: [deferred, server, cleanup]
github_issue:

---

# Centralize duplicated UUID/email identifier regexes instead of inline copies in contract-shape.ts

## Summary

PR #544's `DYNAMIC_KEY_PATTERNS` array in `server/lib/contract-shape.ts` adds two identifier-matching regexes that independently duplicate patterns already defined elsewhere: the UUID regex duplicates `server/index.ts`'s `UUID_RE`, and the email regex duplicates the pattern used in three client files. None of the copies import from a shared constant, so they can drift independently.

## Background

Found during `/review` of PR #544 (server/lib/contract-shape.ts, dynamic-key redaction guard). Both duplications were verified directly:

- `server/index.ts:127-128` defines `const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;` (module-local, unexported, used for `x-request-id` validation). `contract-shape.ts`'s `DYNAMIC_KEY_PATTERNS` contains the byte-identical pattern inline, unconnected.
- The email pattern `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` already exists in `client/components/ChangeEmailModal.tsx` (as `EMAIL_RE`), `client/screens/LoginScreen-utils.ts` (as `EMAIL_PATTERN`), and `client/screens/VerifyEmailScreen-utils.ts` (as `EMAIL_PATTERN`) — the new server-side copy in `contract-shape.ts` is a fourth independent literal. A doc comment claims it "mirrors" `ChangeEmailModal.tsx`'s copy, but nothing enforces that beyond the comment.

Low severity: none of these regexes are security-critical (contract-shape.ts's copies are a heuristic redaction signal, not validation), and this is dev-only middleware. But drift risk is real — a future correctness fix to one copy (e.g. tightening UUID validation, or allowing `+` tags in emails) has no compiler or grep signal pointing at the other copies.

## Acceptance Criteria

- [ ] Export `UUID_RE` from `server/index.ts` (or move it to a shared server-side constants module) and import it into `server/lib/contract-shape.ts`'s `DYNAMIC_KEY_PATTERNS`, removing the inline duplicate.
- [ ] Add an email-matching regex constant to `shared/` (or confirm no cross-boundary import is feasible and document why not) and have `contract-shape.ts` import from it instead of a fresh inline literal. If a shared constant isn't practical for the client copies (verify the actual module-boundary constraints before assuming), at minimum stop claiming the server copy "mirrors" a specific client file in a comment that can't be enforced.
- [ ] `contract-shape.test.ts` continues to pass unchanged — this is a pure dedup, not a heuristic-behavior change.

## Implementation Notes

- Files in scope: `server/lib/contract-shape.ts`, `server/index.ts`, and the three client email-pattern files (`client/components/ChangeEmailModal.tsx`, `client/screens/LoginScreen-utils.ts`, `client/screens/VerifyEmailScreen-utils.ts`) if a shared client+server constant location is pursued.
- The UUID half is straightforward (both copies are server-side; just export and import). The email half is cross-boundary (client + server) — check whether `shared/` is an appropriate home, or whether client and server should each keep their own single source of truth with a comment explaining why they aren't unified.

## Dependencies

- None.

## Risks

- Low — purely a dedup/reuse cleanup, not a behavior change. Main risk is scope creep if the email-regex consolidation touches more client files than intended; keep the client-side change minimal or skip it if cross-boundary reuse isn't clean.

## Updates

### 2026-07-07

- Initial creation — filed during `/review` of PR #544, deferred as low-severity reuse/cleanup per CLAUDE.md's deferred-item policy.
