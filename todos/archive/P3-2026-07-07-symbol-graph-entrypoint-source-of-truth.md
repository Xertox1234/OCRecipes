<!-- Filename: P3-2026-07-07-symbol-graph-entrypoint-source-of-truth.md -->

---

title: "PG Lab symbol-graph: derive entrypoint path from package.json main instead of duplicated literals"
status: done
priority: low
created: 2026-07-07
updated: 2026-07-07
assignee:
labels: [deferred, harness]
github_issue:

---

# PG Lab symbol-graph: derive entrypoint path from package.json main instead of duplicated literals

## Summary

A `/review 541` finding (verified CONFIRMED): `client/index.js` is asserted as an
independent, hand-typed literal string in two different files/languages —
`scripts/pg-lab/symbol-graph.ts`'s `loadProject` (`path.join(configDir, "client/index.js")`)
and `scripts/pg-lab/symbol-graph.sh`'s dead-exports allowlist
(`AND path NOT IN ('client/index.js', 'server/index.ts')`) — with neither reading
`package.json`'s `"main": "client/index.js"` field, which is the actual source of truth.

## Background

PR #541 fixed two real bugs in the PG Lab symbol/import-graph tool (barrel re-export
inflating ref-counts, and `client/index.js` being invisible to `blast`/`cycles`). During
`/review 541`, a verifier confirmed both comments in the fixed code explicitly cite
`package.json "main"` as their justification, but neither script derives from it
programmatically — `git grep` across `scripts/**` for any read of `package.json` returns
nothing. A companion PR-541 fix (the `addSourceFilesAtPaths` loud-failure check, merged in
the same PR) makes a _rename_ of `client/index.js` fail loudly instead of silently, but it
does not remove the duplication itself — a rename still requires editing two independent
literals in two languages, and forgetting one re-triggers one of the two bug classes this
PR fixed (invisible-to-blast, or dead-exports false positive).

## Acceptance Criteria

- [ ] `scripts/pg-lab/symbol-graph.ts`'s `loadProject` reads the entrypoint path from
      `package.json`'s `"main"` field (e.g. `JSON.parse(fs.readFileSync(path.join(configDir,
  "package.json"), "utf8")).main`) instead of the hardcoded `"client/index.js"` literal.
- [ ] `scripts/pg-lab/symbol-graph.sh`'s dead-exports allowlist derives the same value (e.g.
      via `node -p "require('<repo-root>/package.json').main"`) instead of the hardcoded
      `'client/index.js'` literal, OR the allowlist is restructured so both scripts share one
      value (env var, generated file, etc.) — the goal is one source of truth, not
      necessarily identical mechanisms in TS vs bash.
- [ ] The existing fixture regression test in `.claude/hooks/test-pg-lab-symbol-graph.sh`
      still passes; if the fixture doesn't have its own `package.json`, decide whether it
      needs one or whether the derivation gracefully falls back for a fixture project (this
      todo should not regress the fixture's `allowJs`-based `.js`-loading test path).

## Implementation Notes

- `package.json`'s `"main"` field is confirmed stable — never renamed in this repo's
  history (`git log -p --follow -- package.json`).
- The current code (post `/review 541` fixes) already fails LOUDLY if `addSourceFilesAtPaths`
  doesn't find the file it expected — so this todo is a maintainability/DRY improvement, not
  a correctness fix for a live bug. Low severity accordingly.
- `server/index.ts` is also in `symbol-graph.sh`'s allowlist but has no equivalent
  `loadProject` special-case (it's presumably covered by the `server/**/*.ts` glob already,
  unlike `client/index.js`'s `.js` extension) — worth confirming whether `server/index.ts`
  needs the same source-of-truth treatment, or whether it's a different case entirely (no
  `package.json` field defines it as "the" server entrypoint the way `main` does for client).

## Dependencies

- None. PR #541 (merged) is the code this builds on.

## Risks

- Low — this is a dev-tooling script run manually ("Nightly-manual, not a hook" per its own
  header), not a hot path or hook. Scope creep risk: don't expand into a general
  "entrypoints registry" abstraction beyond what these two scripts actually need.

## See Also

- `docs/solutions/logic-errors/ts-morph-export-graph-declaration-identity-gotchas-2026-07-06.md`
  — the barrel-reexport gotcha this same PR fixed.

## Updates

### 2026-07-07

- Filed from a `/review 541` finding (verified CONFIRMED by an independent verifier agent);
  out of scope for that review's direct fix (the loud-failure mitigation was applied instead
  — see PR #541's review-round commit).
