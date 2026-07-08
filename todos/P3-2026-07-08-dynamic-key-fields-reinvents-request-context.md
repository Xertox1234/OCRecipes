<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "server/lib/dynamic-key-fields.ts reinvents the existing request-context.ts AsyncLocalStorage mechanism"
status: backlog
priority: low
created: 2026-07-08
updated: 2026-07-08
assignee:
labels: [server, code-quality]
github_issue:

---

# server/lib/dynamic-key-fields.ts reinvents the existing request-context.ts AsyncLocalStorage mechanism

## Summary

PR #551 added `server/lib/dynamic-key-fields.ts`: a producer marks a response
field as dynamically-keyed via `markDynamicKeyFields(res, [...])`, which writes
to `res.locals`; `contract-snapshot.ts`'s `recordSnapshot` reads it back via
`readDynamicKeyFields(res)`. An ultrareview of that PR found the codebase
already has a comparable, actively-used mechanism for exactly this
"producer sets per-request metadata, a later consumer reads it" pattern:
`server/lib/request-context.ts`, built on `AsyncLocalStorage`, with an existing
`setRequestUserId`-style setter and a consumer (the pino logger's `mixin()`)
that reads it from arbitrary, deeply-nested, arbitrarily-async call sites
throughout the app.

The review's verifier read both files in full and checked each constraint
`dynamic-key-fields.ts`'s own doc comment cites (avoiding `contract-snapshot.ts`'s
heavy `pg`/git-branch dependencies leaking into route files; surviving
`JSON.parse(JSON.stringify(body))`; being readable by `recordSnapshot`, which
already receives `res` directly) and concluded `request-context.ts`'s existing
`RequestContext` interface would satisfy all of them equally well — with the
added benefit that `recordSnapshot` wouldn't need `res` threaded through at all
(it could call `getRequestContext()?.forcedDynamicKeys` directly). Verdict:
**CONFIRMED — a real, avoidable duplication**, not a design tradeoff with a
legitimate reason to prefer `res.locals`.

## Background

Filed during an ultrareview of PR #551 (contract-shape dynamic-key redaction
producer marker), per this project's process for surfacing a confirmed,
Medium+-relevant finding that's genuinely out of scope for the PR that found
it, rather than leaving it undocumented. Not applied directly in that PR
because it would mean adding a dev-only diagnostic field
(`forcedDynamicKeys`) to `RequestContext`, an object that's populated via
`AsyncLocalStorage.run(...)` on _every_ production request (auth + logging
depend on it) — a larger, more foundational change than a same-day PR fixup
warrants, and worth its own considered pass rather than folding in reactively.

**Why:** rated low — this is a code-quality/architecture-consistency finding
(duplicated per-request-metadata convention), not a bug; `res.locals` works
correctly today and is fully isolated to the dev-only `CONTRACT_SNAPSHOT=1`
path. No user-facing or security impact from leaving it as-is.

## Acceptance Criteria

- [ ] Decide whether to migrate `dynamic-key-fields.ts`'s `res.locals` marker to
      `request-context.ts`'s `RequestContext` (adding a `forcedDynamicKeys` field + a `markForcedDynamicKeys`-style setter, parallel to `setRequestUserId`),
      or explicitly keep `res.locals` with a documented rationale.
- [ ] If migrating: confirm `RequestContext`'s `AsyncLocalStorage` scope is
      reliably still active at the point `contract-snapshot.ts`'s wrapped
      `res.json` executes (verify empirically, not just by analogy to the
      logger's `mixin()` pattern, since that reads synchronously from log calls
      rather than from a monkey-patched `res.json`).
- [ ] Update `server/lib/dynamic-key-fields.ts`'s module doc comment and
      `docs/solutions/conventions/redact-dynamic-object-keys-not-just-values-2026-07-07.md`
      either way, so the decision (not just the mechanism) is documented.

## Implementation Notes

- `server/lib/dynamic-key-fields.ts` — `markDynamicKeyFields()`,
  `readDynamicKeyFields()` (current `res.locals` implementation).
- `server/lib/request-context.ts` — `RequestContext`, `getRequestContext()`,
  `setRequestUserId()`, `requestContextMiddleware` (the existing mechanism to
  potentially extend).
- `server/lib/contract-snapshot.ts` — `recordSnapshot()`'s
  `readDynamicKeyFields(res)` call site, would become `getRequestContext()`.
- `server/index.ts` — confirm `requestContextMiddleware` registration order
  relative to `installContractSnapshotMiddleware` still holds if this changes.

## Dependencies

- None. PR #551 already merged (pending); this is a follow-up code-quality
  consideration, not a blocker for anything.

## Risks

- `RequestContext` is a small, widely-relied-upon interface (auth + logging);
  adding a dev-only diagnostic field to it, even conditionally populated,
  slightly widens its surface. Weigh against the duplication cost of keeping
  a second, parallel per-request-metadata mechanism.

## Updates

### 2026-07-08

- Filed during an ultrareview of PR #551, per user instruction to apply
  confirmed/plausible fixes and codify the reusable lesson; this specific
  finding was deliberately left unapplied (see Background) and is filed here
  rather than only mentioned in the PR's commit message.
