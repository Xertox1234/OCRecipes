<!-- Filename: P3-2026-07-09-symbol-graph-sh-allowlist-type-asymmetry.md -->

---

title: "symbol-graph.sh's dead-exports allowlist takes package.json main as a raw string while symbol-graph.ts normalizes it via path.join"
status: backlog
priority: low
created: 2026-07-09
updated: 2026-07-09
assignee:
labels: [deferred, harness, code-quality]
github_issue:

---

# symbol-graph.sh's dead-exports allowlist takes package.json main as a raw string while symbol-graph.ts normalizes it via path.join

## Summary

PR #554 made both `scripts/pg-lab/symbol-graph.ts` and `scripts/pg-lab/symbol-graph.sh` derive the
client entrypoint path from `package.json`'s `"main"` field instead of a hardcoded literal, but the
two scripts handle the derived value differently: `symbol-graph.ts`'s `loadProject` runs it through
`path.join` before comparing, while `symbol-graph.sh`'s dead-exports SQL allowlist takes the raw
string from `package.json` as-is.

## Background

Filed as a deferred warning from PR #554's implementation (`/todo` run, 2026-07-09). Currently
non-load-bearing: the client entrypoint (`client/index.js`) has no exports of its own, so it never
appears in `repo.exports` regardless of this asymmetry — the allowlist entry is a no-op either way
today. But if `"main"` ever gained a `"./"` prefix or other path normalization difference, the TS
side would still normalize correctly while the bash allowlist entry would silently desync from the
real repo-relative path, reintroducing the exact "two independent literals that can drift" problem
PR #554 was filed to close.

## Acceptance Criteria

- [ ] Normalize the derived `package.json` `"main"` value the same way in both
      `scripts/pg-lab/symbol-graph.sh` and `scripts/pg-lab/symbol-graph.ts` (e.g. strip a leading
      `./` in both, or have one script source the other's normalized value), OR add a regression
      test proving the current two forms are equivalent for every value `"main"` could realistically
      take in this repo.
- [ ] `.claude/hooks/test-pg-lab-symbol-graph.sh` continues to pass unchanged (or is extended to
      cover the chosen fix).

## Implementation Notes

- Files: `scripts/pg-lab/symbol-graph.sh`, `scripts/pg-lab/symbol-graph.ts`,
  `.claude/hooks/test-pg-lab-symbol-graph.sh`.
- `package.json`'s `"main"` field is confirmed stable and has never been renamed in this repo's
  history (per PR #554's own research) — this is a defensive/consistency fix, not a response to
  observed drift.

## Dependencies

- None. PR #554 (merged or pending) is the code this builds on.

## Risks

- Low — dev-tooling script, not a hot path or hook; don't expand scope beyond normalizing this one
  value.

## Updates

### 2026-07-09

- Filed as a deferred warning from the `/todo` executor that implemented PR #554, per user
  instruction to convert deferred items into tracked todos.
