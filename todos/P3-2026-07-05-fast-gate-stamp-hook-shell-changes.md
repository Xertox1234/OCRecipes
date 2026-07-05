<!-- Filename: P3-2026-07-05-fast-gate-stamp-hook-shell-changes.md  (P3=low) -->

---

title: "preflight:fast writes a 'verified' stamp for hook/shell changes it never exercised"
status: backlog
priority: low
created: 2026-07-05
updated: 2026-07-05
assignee:
labels: [deferred, ci]
github_issue:

---

# preflight:fast writes a "verified" stamp for hook/shell changes it never exercised

## Summary

`scripts/preflight.sh --fast` writes a HEAD pass-stamp whenever its (possibly empty) related-tests
step didn't get skipped for an unreachable Postgres — but when the changed-file set contains no
`*.ts`/`*.tsx` (an all-`.sh`/hook PR, or docs-only), `--fast` runs only two DB-free steps
(`build:copilot-instructions:check` and whole-program `tsc`) and never exercises the changed
shell/hook logic, yet still stamps HEAD as "verified." Consider running the hook self-test suite
in `--fast` when `.claude/hooks/**` or `.husky/**` changed, before writing the stamp.

## Background

Surfaced by the PR #508 review (the preflight gate consolidation). The consolidation made the
`--fast` stamp the single "this HEAD is verified" token that both the pre-push skip and
`.claude/hooks/pr-preflight-guard.sh` trust. The stamp is correctly _refused_ when related tests
were skipped for an unreachable dev DB — but it is _written_ for a push whose changed set has no
TypeScript, because the changed-file detection only globs `*.ts`/`*.tsx`:

- `scripts/preflight.sh:26-28` builds `CHANGED` from `git diff … -- '*.ts' '*.tsx'`.
- With an empty `CHANGED`, the eslint block and the `pg_isready`/`vitest related` block are both
  skipped, `tests_skipped` stays `0`, and `scripts/preflight.sh:74-77` writes the stamp.

PR #508 itself hit this: it changed only `.sh`/`.md` files, so the push stamp-skipped and the hook
self-tests that actually verify those files ran only because they were invoked by hand
(`bash scripts/run-hook-tests.sh`), not through the gate.

**Severity is low: not a defect that can reach `main`.** CI's required "Lint · Types · Patterns"
job runs `scripts/run-hook-tests.sh` on every PR (verified: it is one of the 8 required checks with
`enforce_admins:true`), so a broken hook is blocked at merge regardless. This is a _local_ signal
that over-claims ("verified") for non-TS changes — a semantic tightening, not a correctness fix.
It is arguably by-design (the stamp means "the fast gate passed"; CI is the source of truth), so
this is a judgment call to weigh, not an obvious bug.

## Acceptance Criteria

- [ ] When `--fast` sees changed files under `.claude/hooks/**` or `.husky/**`, it runs
      `bash scripts/run-hook-tests.sh` before writing the stamp (fail → no stamp, non-zero exit).
- [ ] The changed-hook detection uses the committed push range (same `BASE..HEAD` the existing
      `--fast` scope uses), not the staged/working set.
- [ ] A hermetic `.claude/hooks/test-*.sh` case proves: changed hook file + failing hook test →
      `--fast` exits non-zero and writes NO stamp; changed hook file + passing hook tests → stamp
      written. (Follow the existing `test-preflight-fast-stamp.sh` stubbing pattern.)
- [ ] Decide and document whether an all-docs change (no TS, no hooks) should still stamp — current
      behavior stamps it; that is likely fine (nothing to verify) but should be a conscious choice.
- [ ] `bash scripts/run-hook-tests.sh` stays green; the two consolidation tests
      (`test-preflight-output.sh`, `test-preflight-fast-stamp.sh`) are unaffected.

## Implementation Notes

- Files in scope: `scripts/preflight.sh` (the `--fast` block, roughly lines 22-79) and a new/extended
  `.claude/hooks/test-*.sh` case.
- The `--fast` block already computes `BASE` and a `*.ts`/`*.tsx` `CHANGED` array; add a _separate_
  probe for `.claude/hooks/` + `.husky/` paths in the same `BASE..HEAD` range (a `.ts`-only filter
  misses shell files) and gate `run-hook-tests.sh` on it.
- Mirror the "certify EXECUTED verification" rule already in the block: only write the stamp when
  every verification that _should_ have run for the changed set actually ran and passed.
- `run-hook-tests.sh` is the same runner CI and full `preflight` use, so there is no drift risk from
  calling it here.
- Keep it cheap: only invoke the hook suite when hook/husky files actually changed, so the common
  TS-only fast path is unaffected.

## Dependencies

- None. Independent of PR #508 (which is already open); this hardens the mechanism that PR introduced.

## Risks

- `run-hook-tests.sh` runs ~15 hermetic bash tests (~1-2s); acceptable added latency only on pushes
  that touch hooks. Guard strictly on the changed-hook probe so TS-only pushes never pay it.
- Avoid double-running: full `preflight` mode already runs `run-hook-tests.sh`; ensure `--fast`'s
  invocation is scoped to the fast path and doesn't create a redundant second run in any mode.

## Updates

### 2026-07-05

- Initial creation from the PR #508 review (finding #1). Low severity: CI's required hook-test job
  backstops it; this is a local-signal tightening.
