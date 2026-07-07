<!-- Filename: P3-2026-07-07-contract-shape-redaction-gap-telemetry.md -->

---

title: "No runtime signal when contract-shape.ts's dynamic-key redaction heuristics silently miss a leak"
status: backlog
priority: low
created: 2026-07-07
updated: 2026-07-07
assignee:
labels: [deferred, server]
github_issue:

---

# No runtime signal when contract-shape.ts's dynamic-key redaction heuristics silently miss a leak

## Summary

`server/lib/contract-shape.ts`'s two dynamic-key redaction signals (`looksDynamicallyKeyed`, `hasUniformNonPrimitiveValueShape`) have two documented, "common not rare" residual gaps — but when either gap is hit, nothing indicates it happened: no dev-mode warning, no counter, no marker alongside the stored snapshot. The failure mode (a real leak) is indistinguishable from success (correctly not redacted) until someone manually inspects stored rows.

## Background

Found during `/review` of PR #544 (server/lib/contract-shape.ts). The two accepted gaps, both documented in code comments as common rather than theoretical:

1. A dynamic-keyed object with fewer than `MIN_UNIFORM_MAP_KEYS` (2) entries whose key(s) also don't match a `DYNAMIC_KEY_PATTERN` — e.g. a grocery/menu response with exactly one flagged allergen item, called out in the PR's own comments as an ordinary real-world scenario, not a corner case.
2. A dynamic-keyed object whose values are all primitive (e.g. a hypothetical `Record<string, AllergySeverity>` simplification of `allergenFlags`) — not live today (verified via grep), but "one refactor away from live."

Verified during review: `contract-snapshot.ts`'s `recordSnapshot` has no logging/telemetry call anywhere in the redaction path — its only logger calls cover git-branch resolution, DB-write failure, and synchronous-derivation-throw, none of which fire on a "heuristic missed it" case (`deriveShape` returns a normal, non-throwing shape either way).

Severity is deliberately low/deferred, not ignored: the middleware is opt-in (`CONTRACT_SNAPSHOT=1`), hard-blocked outside `NODE_ENV=development`, writes only to the isolated `ocrecipes_lab`-family `dev.` schema, and stores a single deduplicated shape per `(branch, route_pattern, method, status)` rather than an accumulating per-request log — this meaningfully narrows the real-world exposure compared to a production data path.

## Acceptance Criteria

- [ ] When `deriveShape` (or `recordSnapshot`) processes an object that reaches the plain (non-redacted) key-copy path AND has values that are uniform-but-primitive across >=2 keys (the closest observable proxy for gap #2, since primitives are deliberately excluded from the uniformity signal), emit a dev-mode `logger.debug`/`logger.warn` noting the route pattern and that a uniform-primitive-valued object was NOT redacted — cheap, single-condition check, no new heuristic.
- [ ] Decide whether gap #1 (sub-2-entry dynamic maps) is worth a similar signal, or whether it's too noisy/low-value to detect at runtime (single-entry objects are extremely common and mostly benign) — document the decision either way.
- [ ] No behavior change to what gets redacted — this is observability only, not a new redaction signal.
- [ ] Existing `contract-shape.test.ts` / `contract-snapshot.test.ts` suites pass unchanged.

## Implementation Notes

- Files in scope: `server/lib/contract-shape.ts` (the detection logic), `server/lib/contract-snapshot.ts` (the only place with a `logger` instance today — `deriveShape` itself is currently pure/side-effect-free, so consider whether to keep it that way and have the caller inspect the result, or accept a logger param).
- Consider a lightweight in-memory counter (increment on miss) surfaced via an existing dev-only diagnostics endpoint, rather than a log line per request, if log volume is a concern under CONTRACT_SNAPSHOT=1 dev sessions.

## Dependencies

- None.

## Risks

- False-positive-y: many uniform-primitive-valued static objects are completely benign (e.g. `{ width: 100, height: 50 }`), so a warning fires far more often than it indicates a real leak — needs a signal-to-noise assessment before deciding this is worth shipping, not just "add a log line."

## Updates

### 2026-07-07

- Initial creation — filed during `/review` of PR #544, deferred as low-severity per CLAUDE.md's deferred-item policy (verifier flagged this PLAUSIBLE-but-reasonably-deferrable given the dev-only, prod-blocked, deduplicated-storage scope).
