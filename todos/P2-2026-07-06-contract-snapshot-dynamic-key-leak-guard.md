<!-- Filename: P2-2026-07-06-contract-snapshot-dynamic-key-leak-guard.md -->

---

title: "contract-snapshot.ts can leak dynamic object keys (e.g. user email) despite the 'never leak values' hard requirement"
status: backlog
priority: medium
created: 2026-07-06
updated: 2026-07-06
assignee:
labels: [security, server]
github_issue:

---

# contract-snapshot.ts can leak dynamic object keys despite the "never leak values" hard requirement

## Summary

`server/lib/contract-shape.ts` (PR #529, PG Lab API contract snapshot/diff) derives a structural type-skeleton from JSON responses for storage in `dev.contract_snapshots` — the todo's own Implementation Notes state responses "contain user health data; storing values is out of bounds," so the tool must NEVER store raw values. A second-opinion review found that object _key names_ are stored verbatim and are structurally indistinguishable from static schema keys — if any route returns a dynamically-keyed object (e.g. `{ [userEmail]: nutrition }`, `{ [ingredientName]: ... }`), those key strings leak into the stored shape data despite no route currently doing this.

## Background

Found during a second-opinion review pass over this session's `/todo` batch PRs (PR #529). The PR's own doc comment in `contract-shape.ts` concedes the gap: "no current route does this... this function has no defense against that." This is currently a latent/theoretical risk — no route in the app currently returns a dynamically-keyed response object — but the tool's entire premise is "never leak values," and resting that guarantee solely on "no route does this today" is fragile: a future route change could silently start leaking real health-adjacent identifiers with no warning.

## Acceptance Criteria

- [ ] `deriveShape()` (or its caller) detects objects whose keys don't look like a small, fixed, static field set (e.g. an unusually high key count, or keys matching identifier-unlikely shapes like emails/UUIDs/numeric IDs) and either refuses to record that object's keys literally (replacing with a placeholder like `<dynamic>`) or caps/redacts them.
- [ ] Add a config knob or clear code comment for what threshold/heuristic decides "this looks like a dynamic-keyed object" — document the tradeoff (false positives on legitimately-static-but-large objects vs. false negatives that still leak).
- [ ] Regression test: a response shaped like `{ [userEmail]: {...} }` must NOT have the literal email(s) appear in the derived shape or in `dev.contract_snapshots`.
- [ ] Existing static-shape behavior (the common case — fixed field names) must be unaffected; re-run the existing `contract-shape.test.ts` / `contract-snapshot.test.ts` suites to confirm no regression.

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
