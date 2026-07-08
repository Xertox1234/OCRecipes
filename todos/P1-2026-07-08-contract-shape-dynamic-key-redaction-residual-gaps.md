<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "contract-shape.ts dynamic-key redaction has two accepted, non-theoretical false-negative gaps"
status: backlog
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

- [ ] Evaluate the producer-side-marker approach at the two known call sites
      (`grocery.ts`'s `allergenFlags`, `menu-analysis.ts`'s `allergenFlags`) as an alternative
      or supplement to the heuristic signals already in `deriveShape`.
- [ ] Either close the two documented gaps (single-entry pattern-miss; all-primitive-valued
      dynamic map) or make an explicit, user-visible decision to accept them permanently with
      a clearly justified rationale (not just a code comment).
- [ ] Regression tests for both previously-uncaught scenarios if closed via new logic.

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
