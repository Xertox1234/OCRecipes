<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "contract-diff-cli.ts prints pre-redaction dynamic key names when diffing old vs. new contract snapshots"
status: done
priority: high
created: 2026-07-08
updated: 2026-07-08
assignee:
labels: [security, server]
github_issue:

---

# contract-diff-cli.ts prints pre-redaction dynamic key names when diffing old vs. new contract snapshots

## Summary

PR #544 added dynamic-object-key redaction to `deriveShape()` in `server/lib/contract-shape.ts`
so future writes to `dev.contract_snapshots` never store real dynamic key names (e.g. real
grocery/menu item names next to allergy data). But `diffRouteShapes`/`unwrapToKeys` (also in
`contract-shape.ts`, unchanged by #544) and `scripts/pg-lab/contract-diff-cli.ts` have no
awareness of the new `<dynamic>` placeholder — diffing an old (pre-fix) snapshot against a new
(post-fix) one for the same route reports the old real key names as `removed` and `<dynamic>`
as `added`, and `contract-diff-cli.ts`'s `formatReport` prints those names verbatim to stdout.

## Background

Found during code review of PR #544 (`security-auditor` + `code-reviewer` review, confirmed
CONFIRMED). `server/lib/contract-snapshot.ts`'s upsert is keyed on
`ON CONFLICT (branch, route_pattern, method, status)`, so an old `main`-branch snapshot
persists untouched until `main` is re-exercised post-merge — meaning the canonical pre-merge
verification workflow (`contract-diff.sh` comparing base `main` vs. a feature branch) is
exactly the scenario that reprints unredacted key names to a developer's terminal or CI log,
undermining the whole point of PR #544's fix for any snapshot recorded before it shipped.

**Why:** rated high, not critical — this is a dev-only local tool (`ocrecipes_lab`, gated
behind `CONTRACT_SNAPSHOT=1`, never runs against production), but it's a real, mechanically
confirmed secondary leak channel for the exact class of data PR #544 exists to protect, and
it will keep firing every time someone diffs against a pre-#544 snapshot until fixed.

## Acceptance Criteria

- [x] `diffRouteShapes` (or its caller) treats a key transitioning to/from the `<dynamic>`
      placeholder as a redaction, not an ordinary added/removed key — never printing the OLD
      real key names in that case.
- [x] `contract-diff-cli.ts`'s report output never contains a raw, non-`<dynamic>` dynamic key
      name sourced from a pre-redaction snapshot.
- [x] Regression test: diff an old-style shape (real key names, as `deriveShape` produced
      before PR #544) against a new-style shape (`<dynamic>` placeholder) for the same route
      and assert the report contains no real key name.

## Implementation Notes

- `server/lib/contract-shape.ts` — `diffRouteShapes()`, `unwrapToKeys()`.
- `scripts/pg-lab/contract-diff-cli.ts` — `formatReport()`, the `keyDiffs`/`added`/`removed`
  printing (around the `for (const k of d.removed) lines.push(...)` loop).
- Simplest fix candidate: when comparing keys, treat any key equal to `DYNAMIC_KEY_PLACEHOLDER`
  ("`<dynamic>`") as a wildcard that never appears in `removed`/`added` lists on its own —
  only report it as `retyped` if BOTH sides are (or aren't) the placeholder and the merged
  value shape actually differs.

## Dependencies

- None. PR #544 already merged; this is a pure follow-up to the diff tooling.

## Risks

- Low — read-only diff-reporting logic, no data-write path involved.

## Updates

### 2026-07-08

- Filed during code review of PR #544 (merged as 137b746e), per user instruction to merge
  and file findings as follow-up todos.

### 2026-07-08 — Resolved

- Fixed in `diffRouteShapes()` (`server/lib/contract-shape.ts`): added a module-private
  `isRedactedKeySet()` guard. When exactly one side's key set is the sole `<dynamic>`
  placeholder, the diff no longer compares raw key names at all — it reconstructs what
  post-#544 `deriveShape()` would have stored for the unredacted side
  (`mergeShapes(Object.values(realKeys))`, reusing the exact same helper `deriveShape` uses)
  and compares value shapes only, collapsing to `retyped: ["<dynamic>"]` (or no diff) —
  never emitting the real key names. `formatReport()` in `contract-diff-cli.ts` required no
  change since it only prints whatever `diffRouteShapes` returns.
- Regression tests added: 3 cases in `server/lib/__tests__/contract-shape.test.ts`
  (`diffRouteShapes` describe block — same-shape/no-diff, changed-shape/retyped, and the
  symmetric reversed-sides case) plus 1 end-to-end case in
  `scripts/pg-lab/__tests__/contract-diff-cli.test.ts` (`formatReport` describe block)
  proving the printed CLI output never contains a real dynamic key name. Also manually
  smoke-tested the actual `contract-diff-cli.ts` script via stdin with a hand-built
  old-vs-new payload — confirmed real emails never appear in stdout.
- Known, accepted boundary (not a regression, out of scope for this fix): a route whose
  keys never trip the `<dynamic>` heuristic, or two pre-#544 snapshots on both branches,
  still prints real key names via the normal path — that isn't the pre-#544-vs-post-#544
  migration channel this todo addresses.

> **CORRECTED 2026-07-08** — the fix above was too broad. See the "xhigh code review +
> correction" Updates entry below for the full correction; do not treat the claims above
> as the final, verified state of `diffRouteShapes()`.

### 2026-07-08 — xhigh code review + correction

- An xhigh-effort multi-agent code review of the PR above (10 independent finder angles +
  a gap sweep) found that the `isRedactedKeySet()` interception was too broad: it fired on
  ANY `baseRedacted !== featureRedacted` asymmetry, without checking whether the
  non-redacted side's real keys would themselves qualify as dynamic under `deriveShape`'s
  own heuristics. Confirmed via direct execution: a route that genuinely changed from a
  static object (`{ width, height }`) to an unrelated dynamically-keyed map — with
  coinciding merged value types — was reported as **"no differences,"** silently
  swallowing a real API contract change. A related, lower-severity gap: even when a real
  difference WAS detected, it collapsed to a lossy `retyped: ["<dynamic>"]` instead of the
  real (safe) `added`/`removed` key names. A third, related gap: a real static field
  literally named the string `"<dynamic>"` was misclassified as a redaction placeholder.
  The review also found two **pre-existing** (not introduced by this PR, but living in the
  exact function it touches) `__proto__`-prototype-chain bugs in the unmodified per-key
  loop, where `key in obj` walks the prototype chain and silently drops or misclassifies a
  genuine `__proto__`-named key.
- Fixed by re-applying `deriveShape`'s own redaction heuristic
  (`looksDynamicallyKeyed` / `hasUniformNonPrimitiveValueShape`) to the non-redacted side
  before trusting the interception — only collapse to a value-shape-only comparison when
  that side would actually be redacted by `deriveShape` today; otherwise fall through to
  the normal per-key loop, which safely reports real key names (they were never
  classified as sensitive/dynamic). This single guard resolves both the false-negative and
  the `"<dynamic>"`-literal-name collision. The `__proto__` bugs were fixed by replacing
  `key in obj` with `Object.prototype.hasOwnProperty.call(obj, key)`, matching the
  project's existing convention (`server/services/image-art-direction.ts`).
- 5 new regression tests added to `server/lib/__tests__/contract-shape.test.ts` covering
  the false negative, the precision-loss case, the `"<dynamic>"`-literal collision, and
  both `__proto__` directions. All 49 tests pass (44 prior + 5 new); typecheck and lint
  clean; the original migration-scenario tests still pass unchanged, confirming the
  leak-prevention property is preserved alongside the correctness fix.
- Codified as
  [redaction-diff-intercept-must-validate-both-sides-not-just-asymmetry-2026-07-08.md](../../docs/solutions/logic-errors/redaction-diff-intercept-must-validate-both-sides-not-just-asymmetry-2026-07-08.md).
