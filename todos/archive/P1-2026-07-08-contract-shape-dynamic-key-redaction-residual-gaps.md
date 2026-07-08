<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "contract-shape.ts dynamic-key redaction has two accepted, non-theoretical false-negative gaps"
status: done
priority: high
created: 2026-07-08
updated: 2026-07-08
assignee:
labels: [security, server]
github_issue:

---

# contract-shape.ts dynamic-key redaction has two accepted, non-theoretical false-negative gaps

## Summary

PR #544 added two independent heuristics to `deriveShape()` in `server/lib/contract-shape.ts`
to redact dynamically-keyed objects (e.g. `allergenFlags` keyed by grocery/menu item names)
before storage. The PR's own code comments document two residual false-negative gaps it
knowingly accepted rather than closed: (1) a dynamic-keyed object with fewer than 2 entries
whose key(s) don't match a pattern — explicitly called **"COMMON, not a rare edge case"** for
the live `allergenFlags` routes; (2) a dynamic-keyed object whose values are all primitive,
uncaught at any entry count.

## Background

Found during code review of PR #544. Per this project's CLAUDE.md "Deferred Item Todos"
process, a Medium+ severity gap that's genuinely out of scope for the current PR must be
surfaced to the user, not left undocumented in code comments alone — that surfacing happened
in the PR #544 review conversation and this todo is the resulting follow-up. The gaps are real
and reachable, not hypothetical: the archived todo `todos/archive/P2-2026-07-06-contract-snapshot-dynamic-key-leak-guard.md`
itself states "closing them exhaustively was judged out of scope for this pass."

A code-review altitude critique found the PR's own rejection of a per-route allowlist
("~45 route modules... a second, drift-prone place to update") was accurate for the allowlist
idea it describes, but a narrower **producer-side marker** at just the 2 real dynamic-key-
producing modules (`server/routes/grocery.ts`, `server/services/menu-analysis.ts`) was never
evaluated and could close both gaps deterministically. One wrinkle found during review:
`contract-snapshot.ts`'s `recordSnapshot` round-trips the response body through
`JSON.parse(JSON.stringify(body))` before calling `deriveShape`, which would silently strip a
non-JSON marker (a Symbol or non-enumerable property) attached at the producer — so a marker
approach needs either a JSON-visible marker or restructuring `deriveShape`/`recordSnapshot` to
carry marker info alongside the normalized value.

**Why:** rated high — this is the tool's stated hard security invariant ("never leak values...
and now never leak dynamic key names"), and one gap is explicitly conceded as routinely
reachable today for a live, health-adjacent-data route, not an edge case.

## Acceptance Criteria

- [x] Evaluate the producer-side-marker approach at the two known call sites
      (`grocery.ts`'s `allergenFlags`, `menu-analysis.ts`'s `allergenFlags`) as an alternative
      or supplement to the heuristic signals already in `deriveShape`.
- [x] Either close the two documented gaps (single-entry pattern-miss; all-primitive-valued
      dynamic map) or make an explicit, user-visible decision to accept them permanently with
      a clearly justified rationale (not just a code comment).
- [x] Regression tests for both previously-uncaught scenarios if closed via new logic.

## Implementation Notes

- `server/lib/contract-shape.ts` — `looksDynamicallyKeyed()`, `hasUniformNonPrimitiveValueShape()`,
  `deriveShape()`'s object branch.
- `server/lib/contract-snapshot.ts` — `recordSnapshot()`'s `JSON.parse(JSON.stringify(body))`
  normalization step, relevant if pursuing a marker-based approach.
- `server/routes/grocery.ts` (~line 245, `res.json({ ...list, allergenFlags })`) and
  `server/services/menu-analysis.ts` (~line 209, `return { ...validated, allergenFlags }`) —
  the two real producer call sites.

## Dependencies

- None. PR #544 already merged; this closes gaps it explicitly accepted.

## Risks

- A marker-based approach changes the shape of `deriveShape`'s contract (pure function taking
  arbitrary JSON) — needs care to keep it a clean, testable addition rather than route-context
  creeping into a currently route-agnostic pure function.

## Updates

### 2026-07-08

- Filed during code review of PR #544 (merged as 137b746e), per user instruction to merge
  and file findings as follow-up todos.

### 2026-07-08 (resolved)

- Implemented the producer-side marker: `server/lib/dynamic-key-fields.ts`
  (`markDynamicKeyFields` / `readDynamicKeyFields`) stores field names on
  `res.locals` — not on the response body, so it can't leak to the client and
  isn't stripped by `recordSnapshot`'s `JSON.parse(JSON.stringify(body))`
  round-trip (the wrinkle flagged in this todo's Background). `deriveShape` gained
  an optional `forcedDynamicKeys` parameter that force-redacts a marked field
  deterministically at any entry count and any value shape, via a new
  `deriveForcedDynamicShape` helper — closing both accepted gaps for the two known
  producers.
- Wired into `server/routes/grocery.ts` and `server/routes/menu.ts` (the actual
  `res.json` call site for `menu-analysis.ts`'s `allergenFlags`), each calling
  `markDynamicKeyFields(res, ["allergenFlags"])` immediately before `res.json`.
- Kept as **defense-in-depth alongside**, not a replacement for, the existing
  `looksDynamicallyKeyed`/`hasUniformNonPrimitiveValueShape` heuristics — an
  unmarked future route with the same shape still falls back to them.
- Explicit, user-visible residual-risk decision (per this todo's 2nd acceptance
  criterion): the marker is a hand-maintained list and therefore still fail-open in
  the same shape as the allowlist-is-a-denylist pattern
  (`docs/solutions/best-practices/widening-allowlist-root-creates-hand-maintained-denylist-2026-07-08.md`).
  Accepted because the residual surface is narrow — an identifier-shaped key or a
  > =2-entry non-primitive map still trips the heuristics regardless of marking, so
  > only a free-text-keyed, single-entry-or-all-primitive map on a _new, unmarked_
  > route remains exposed, a materially smaller surface than the pre-#544 state.
  > Documented in `contract-shape.ts`'s doc comments, `dynamic-key-fields.ts`'s
  > module comment, and this convention doc's 2026-07-08 update.
- Regression tests added at both layers: unit (`deriveShape` + `forcedDynamicKeys`,
  both positive and negative fixtures proving the marker — not something else — is
  what closes the gap) and integration (`installContractSnapshotMiddleware` +
  `markDynamicKeyFields` mechanism test, plus real-route linkage tests in
  `grocery.test.ts` and `menu.test.ts` proving the actual routes call the marker,
  not just that the mechanism works in isolation).
- Convention doc updated: `docs/solutions/conventions/redact-dynamic-object-keys-not-just-values-2026-07-07.md`.
- Verified: `tsc --noEmit` clean, `eslint` clean, 118 tests passing across the 5
  affected suites.
- Landed on `todo/contract-shape-dynamic-key-redaction-residual-gaps` off `main`
  (commits 5ecd060a, 316a69b9) rather than in the session's assigned worktree —
  that worktree turned out to be a stale, unrelated, already-pushed feature branch
  (`worktree-widen-todo-automerge-path-gate`, 12 commits about the todo-automerge
  path-gate widening); work was recovered onto a fresh branch after being
  mistakenly made directly on `main`'s working tree (absolute paths were used
  instead of the worktree path throughout the session — caught via an ESLint "no
  files matching" error, before anything was committed to `main`).
