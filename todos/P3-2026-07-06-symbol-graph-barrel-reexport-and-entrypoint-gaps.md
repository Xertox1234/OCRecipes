<!-- Filename: P3-2026-07-06-symbol-graph-barrel-reexport-and-entrypoint-gaps.md -->

---

title: "PG Lab symbol-graph: barrel re-exports inflate ref-counts (false negatives) and client/index.js is invisible to blast/cycles"
status: backlog
priority: low
created: 2026-07-06
updated: 2026-07-06
assignee:
labels: [deferred, harness]
github_issue:

---

# PG Lab symbol-graph: barrel re-exports inflate ref-counts and client/index.js is invisible to blast/cycles

## Summary

A second-opinion review of PR #533 (PG Lab TypeScript symbol/import-graph snapshot) found two real gaps beyond the three bugs already fixed during implementation: (1) barrel re-export edges (`export { x } from "./y"`) are counted the same as genuine import edges, inflating cheap ref-counts and hiding genuinely dead exports (a false negative — the opposite direction from the already-fixed duplicate-row bug); (2) `client/index.js` is excluded from the ts-morph project glob (`client/**/*.{ts,tsx}` only), making it invisible to the `blast`/`cycles` queries entirely, not just ref-counting — currently patched around only for `dead-exports` via a narrow hardcoded allowlist entry in `symbol-graph.sh`.

## Background

Found during second-opinion review of this session's `/todo` batch PRs. Confirmed live against the real repo: 7+ files (`server/storage/index.ts`, `client/camera/index.ts`, `client/components/recipe-detail/index.ts`, `server/__tests__/factories/index.ts`, etc.) use named `export {...} from` re-exports, so the barrel-counting issue is not hypothetical. `client/index.js` was confirmed to exist and do `import App from "@/App"` — a real root edge invisible to the graph.

## Acceptance Criteria

- [ ] Import edges gain a "kind" discriminator (genuine `ImportDeclaration` vs. pass-through re-export), and `cheapCounts`/ref-count logic only counts genuine imports — a barrel's mere re-export of `x` must not itself count as a reference to `x`.
- [ ] `dead-exports` re-triaged after the fix: record in Updates whether the false-negative rate changes materially now that barrel counting is corrected.
- [ ] `loadProject`'s glob is extended (or a documented exception added) so `client/index.js` — and any other root-level `.js` entry points — are included in the graph, restoring the edge itself rather than just papering over it via the `dead-exports` allowlist hack in `symbol-graph.sh`.
- [ ] Regression test: a fixture with a barrel `export {x} from "./y"` and zero real importers of `x` must report `x` as dead; a fixture importing a `.js` entry point must show that edge in `blast`.

## Implementation Notes

- Files in scope: `scripts/pg-lab/symbol-graph.ts` (edge model + `cheapCounts` + `loadProject`'s glob), `scripts/pg-lab/symbol-graph.sh` (remove the `client/App.tsx` hardcoded allowlist entry once the real fix lands).
- This is a dev-only internal tooling accuracy issue (no security/data-integrity impact) — affects trust in `dead-exports`/`blast`/`cycles` output for future dead-code sweeps, not app correctness.
- Live-test against the real repo (not just the fixture) per this tool's own established pattern — the three bugs fixed during the original implementation were all caught this way, not by the fixture test.

## Dependencies

- None. Independent of PR #533's merge status.

## Risks

- Low — dev-tool accuracy only. Worst case if left unfixed: `dead-exports`/`blast`/`cycles` output is quietly less trustworthy than it appears, risking a future dead-code deletion sweep missing real usages or missing real dead code.

## Updates

### 2026-07-06

- Initial creation — filed during second-opinion review of this session's `/todo` batch PRs, per user instruction to fix directly or file a followup for anything not immediately fixable.
