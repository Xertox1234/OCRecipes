<!-- Filename: P2-2026-07-06-contract-snapshot-dynamic-key-leak-guard.md -->

---

title: "contract-snapshot.ts can leak dynamic object keys (e.g. user email) despite the 'never leak values' hard requirement"
status: done
priority: medium
created: 2026-07-06
updated: 2026-07-07
assignee:
labels: [security, server]
github_issue:

---

# contract-snapshot.ts can leak dynamic object keys despite the "never leak values" hard requirement

## Summary

`server/lib/contract-shape.ts` (PR #529, PG Lab API contract snapshot/diff) derives a structural type-skeleton from JSON responses for storage in `dev.contract_snapshots` — the todo's own Implementation Notes state responses "contain user health data; storing values is out of bounds," so the tool must NEVER store raw values. A second-opinion review found that object _key names_ are stored verbatim and are structurally indistinguishable from static schema keys — if any route returns a dynamically-keyed object (e.g. `{ [userEmail]: nutrition }`, `{ [ingredientName]: ... }`), those key strings leak into the stored shape data.

> **CORRECTED 2026-07-07** — "despite no route currently doing this" below was **wrong**. `server/routes/grocery.ts` and `server/services/menu-analysis.ts` both already return a dynamically-keyed `allergenFlags` object. See the `### 2026-07-07` Updates entry for the full correction and the fix.

## Background

Found during a second-opinion review pass over this session's `/todo` batch PRs (PR #529). The PR's own doc comment in `contract-shape.ts` concedes the gap: "no current route does this... this function has no defense against that."

> **CORRECTED 2026-07-07** — the rest of this paragraph's premise ("no route in the app currently returns a dynamically-keyed response object... this is currently a latent/theoretical risk") was **wrong** — see the `### 2026-07-07` Updates entry below. Retained here verbatim as the original (mistaken) filing rationale; do not treat it as current fact.
>
> This is currently a latent/theoretical risk — no route in the app currently returns a dynamically-keyed response object — but the tool's entire premise is "never leak values," and resting that guarantee solely on "no route does this today" is fragile: a future route change could silently start leaking real health-adjacent identifiers with no warning.

## Acceptance Criteria

- [x] `deriveShape()` (or its caller) detects objects whose keys don't look like a small, fixed, static field set (e.g. an unusually high key count, or keys matching identifier-unlikely shapes like emails/UUIDs/numeric IDs) and either refuses to record that object's keys literally (replacing with a placeholder like `<dynamic>`) or caps/redacts them.
- [x] Add a config knob or clear code comment for what threshold/heuristic decides "this looks like a dynamic-keyed object" — document the tradeoff (false positives on legitimately-static-but-large objects vs. false negatives that still leak).
- [x] Regression test: a response shaped like `{ [userEmail]: {...} }` must NOT have the literal email(s) appear in the derived shape or in `dev.contract_snapshots`.
- [x] Existing static-shape behavior (the common case — fixed field names) must be unaffected; re-run the existing `contract-shape.test.ts` / `contract-snapshot.test.ts` suites to confirm no regression.

## Implementation Notes

- Files in scope: `server/lib/contract-shape.ts` (the `deriveShape`-equivalent function), possibly `server/lib/contract-snapshot.ts` if the guard needs to run at the recording layer instead.
- Consider: is there a legitimate need for ANY dynamic-keyed route response in this app? If not, an allowlist of expected top-level route response keys (per route pattern) might be simpler and more robust than a heuristic detector.
- Cross-reference the existing PR #529 discussion: two SUGGESTIONs from the same review (CPU overhead of the shape-derivation, `req.baseUrl` reset under the error handler) were accepted as documented residual risk — this one is different in kind because it fails the tool's stated hard requirement, not just a performance/edge-case tradeoff.

## Dependencies

- None. Independent of PR #529's merge status (fix can land as a follow-up PR regardless of when #529 merges).

## Risks

- A heuristic detector could have false positives (flagging a legitimately-static object with many fields) or false negatives (a dynamic-keyed object that happens to look static, e.g. exactly 2-3 dynamic keys). Prefer an explicit allowlist-of-known-shapes approach if the route surface is small enough to enumerate.

## Updates

### 2026-07-06

- Initial creation — filed during second-opinion review of this session's `/todo` batch PRs, per user instruction to fix directly or file a followup for anything not immediately fixable.

### 2026-07-07

- **Correction to the Background section's premise.** The claim "no route in the app currently returns a dynamically-keyed response object" was **wrong**, discovered during a security-auditor review of the first implementation pass: `server/routes/grocery.ts` (`GET /api/meal-plan/grocery-lists/:id`) and `server/services/menu-analysis.ts` (consumed by `POST /api/menu/scan`) both return a live `allergenFlags` object keyed by free-text grocery-item / menu-item names, flagging which foods trigger a user's allergies — exactly the dynamically-keyed, health-adjacent pattern this todo was filed to guard against, already shipping today, not a theoretical future risk.
- The first implementation pass (key-shape pattern matching: email/UUID/long-numeric-id regexes + a >50-key count threshold) did NOT catch this, because free-text item names like "shrimp" match none of the patterns and a realistic grocery/menu list rarely exceeds 50 items.
- Added a second, independent detection signal — `hasUniformNonPrimitiveValueShape()` in `server/lib/contract-shape.ts` — that redacts an object's keys whenever **all of its values derive to the exact same non-primitive (object/array) structural shape** (>= 2 entries), which is what a dynamically-keyed map of same-shaped records looks like regardless of what the keys themselves are named. Verified against the actual `allergenFlags` shape (`{ [itemName]: { allergenId, severity } }`) via a new regression test.
- Corrected the stale "no current route does this" doc comments in `contract-shape.ts` to name the live routes and the second signal.
- Residual accepted risk (documented in code, hardened after a round-2 security-auditor pass that verified the fix closes the reported leak but found two further gaps):
  1. A dynamically-keyed object with fewer than 2 entries whose key(s) also don't match a `DYNAMIC_KEY_PATTERN` (e.g. exactly one flagged allergen) is still not caught by either signal. This is **common, not a rare edge case** — a user with exactly one matching allergen on a grocery/menu list is an ordinary scenario for the two live routes above, not a corner case.
  2. A dynamically-keyed object whose values are all **primitive** (e.g. a hypothetical simplification of `allergenFlags` from `Record<string, {allergenId, severity}>` to `Record<string, AllergySeverity>`) is caught by neither signal at any entry count — primitives are deliberately excluded from the uniform-shape signal because they collide constantly in legitimate static records (`{ width, height }`, `{ r, g, b }`). Not live in this codebase today (verified via grep — no route returns a `Record<string, primitive>` response shape), but a real, not merely theoretical, gap: one refactor away from live.
  - Both gaps are within the class of residual risk this todo's own Risks section already accepted ("false negatives that still leak... prefer allowlist if route surface is small enough"); closing them exhaustively was judged out of scope for this pass — see `docs/solutions/conventions/redact-dynamic-object-keys-not-just-values-2026-07-07.md` for the codified convention and its documented boundaries.
