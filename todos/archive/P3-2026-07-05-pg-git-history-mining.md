<!-- Filename: P3-2026-07-05-pg-git-history-mining.md -->

---

title: "PG Lab: git history mining — churn hotspots and co-change coupling"
status: done
priority: low
created: 2026-07-05
updated: 2026-07-06
assignee:
labels: [deferred, harness]
github_issue:

---

# PG Lab: git history mining — churn hotspots and co-change coupling

## Summary

Import `git log --numstat` into `repo.commits` / `repo.file_changes` and ship canned queries for churn hotspots and co-change coupling ("these two files change together N% of the time"), which git itself answers badly.

## Background

Master plan: `docs/research/2026-07-05-pg-lab-roadmap.md`. Co-change coupling is a documented trap in this repo — the InsertUser `.pick()` decoupling memory is exactly a "these files must change together but nothing says so" bug. A queryable co-change matrix surfaces such pairs systematically, and can later feed the Phase D injection-ranking layer (git-aware boosts).

## Acceptance Criteria

- [x] `scripts/pg-lab/schema/git-mining.sql`: `repo.commits(sha, ts, author, subject)` + `repo.file_changes(sha, path, additions, deletions)`.
- [x] `scripts/pg-lab/git-mine.sh --import`: incremental from last imported sha; `--rebuild` re-imports full history (derived projection; rebuild ≈ minutes, acceptable).
- [x] `scripts/pg-lab/git-mine.sh hotspots [--since 6mo]`: churn (commit count × line churn) ranked, filtered to existing files.
- [x] `scripts/pg-lab/git-mine.sh coupled <path> [--min-support 5]`: files co-changing with `<path>`, with support count and confidence %, excluding lockfiles/generated files (share the exclusion list with the repo's existing generated-file conventions).
- [x] Renames followed (`--numstat -M` parsing of `old => new` paths) or explicitly documented as not-followed in v1.
- [x] Value probe: run `coupled shared/schema.ts` — it must rediscover the known schema↔pick-list coupling; record the output in Updates as the smoke test.
- [x] Fixture test: import a synthetic repo history (fixture text, not a real git call) and assert both queries.

## Implementation Notes

- Parse `git log --numstat --format=...` in one pass (awk or a small TS script — implementer's call; TS gets type-checking, bash matches the pg-lab convention so far).
- Binary files report `-` for numstat counts — store 0 and a flag.
- Co-change SQL: self-join file_changes on sha with support/confidence aggregation — keep it a VIEW so thresholds are query-time.

## Dependencies

- `P3-2026-07-05-pg-lab-foundation-codify-near-dup.md` MERGED.

## Risks

- Monorepo path moves (2026 route/storage domain splits) fragment identity — rename-following matters more here than in most repos; if v1 skips it, say so loudly in the report output.

## Updates

### 2026-07-05

- Initial creation from PG Lab roadmap (Batch C).

### 2026-07-06

- Implemented: `scripts/pg-lab/schema/git-mining.sql` (`repo.commits`, `repo.file_changes`
  with a `UNIQUE(sha, path)` + `is_binary` flag, a singleton `repo.import_cursor` for
  incremental resume, and two views — `repo.co_change_pairs` and
  `repo.file_commit_counts` — so support/confidence thresholds stay query-time per the
  implementation notes) and `scripts/pg-lab/git-mine.sh` (`--rebuild` / `--import` /
  `hotspots [--since 6mo]` / `coupled <path> [--min-support N]`).
- **Renames: NOT followed in v1** (per the todo's documented-alternative). `git-mine.sh`
  invokes `git log --no-renames --numstat` deliberately — a renamed file is stored as an
  unrelated delete (old path) + add (new path), not a linked identity. This fragments
  co-change history across the 2026 route/storage domain-split moves, exactly the risk the
  todo called out; said loudly in `git-mining.sql`'s header comment, `git-mine.sh`'s header
  comment, and here.
- Binary files (`git numstat` reports `-`/`-`) are stored as `additions=0, deletions=0,
is_binary=true` — verified via a dedicated fixture-test row.
- Exclusion list (lockfiles/generated files) is derived at query time from
  `.prettierignore`'s entries (`package-lock.json`, `.github/copilot-instructions.md`,
  `docs/solutions/`) unioned with common lockfile basenames not yet in that file
  (`yarn.lock`, `pnpm-lock.yaml`, `Podfile.lock`, `Gemfile.lock`, `composer.lock`) — shares
  the repo's one existing generated-file registry instead of a second hand-copied list, and
  is applied to both `hotspots` and `coupled` (a lockfile would otherwise dominate churn
  rankings outright).
- Test seam `PG_LAB_GIT_LOG_RAW` (mirrors `codify-neardup.sh`'s `PG_LAB_SOLUTIONS_DIR`)
  lets `git-mine.sh` read literal `git log --numstat --format=…` text instead of shelling
  to git — `.claude/hooks/test-pg-lab-git-mine.sh` uses it for a full `--rebuild` /
  `--import` / `hotspots` / `coupled` round-trip against a synthetic 6-commit fixture, with
  NO real git call, 29 assertions, all passing (included in `scripts/run-hook-tests.sh`'s
  glob, verified against the full 18-file hook suite).
- Applied two directly relevant existing solutions found during research: never mix `psql
-c` with `:'var'` substitution (`docs/solutions/logic-errors/psql-c-flag-skips-var-substitution-2026-07-05.md`)
  — every parameterized `psql` call here goes through a heredoc; and count-and-fail-on-zero
  (`docs/solutions/logic-errors/glob-runner-loop-fails-open-count-and-fail-on-zero-2026-07-03.md`)
  — `--rebuild` refuses to truncate the table if 0 commits were parsed (verified in the
  fixture test), while `--import`'s normal "0 new commits" case exits 0 with a message, not
  an error. Also defensively `unset GIT_DIR GIT_WORK_TREE …` before the real git call, per
  `docs/solutions/logic-errors/inherited-git-dir-overrides-git-c-in-hook-self-tests-2026-06-26.md`
  (an inherited absolute `GIT_DIR` would otherwise silently mine the wrong repo).
- Two real implementation bugs caught during manual smoke-testing (before code review):
  a column-order mismatch in the `INSERT INTO repo.file_changes` load (`SELECT` list didn't
  match the target column list, would have swapped `path`/`additions`/`deletions` values on
  every import), and an EXIT trap referencing function-`local` variables that go out of
  scope by the time the trap fires (fixed by interpolating the paths into the trap string
  at set-time instead of leaving them as a deferred variable reference).
- **Value probe (smoke test):** ran `LAB_DATABASE_URL=postgresql://localhost/ocrecipes_lab
scripts/pg-lab/git-mine.sh --rebuild` against this repo's REAL history (1766 commits,
  imported in ~2s), then `coupled shared/schema.ts` with default args. Output (excerpt,
  top 20 by confidence):

  ```
                      coupled_path                    | support | confidence_pct
  ----------------------------------------------------+---------+----------------
   server/storage/index.ts                            |      27 |           26.0
   server/routes.ts                                   |      26 |           25.0
   server/storage.ts                                  |      18 |           17.3
   server/routes/chat.ts                              |      16 |           15.4
   server/storage/meal-plans.ts                       |      15 |           14.4
   docs/LEARNINGS.md                                  |      13 |           12.5
   server/storage/users.ts                            |      13 |           12.5
   package.json                                       |      13 |           12.5
   docs/PATTERNS.md                                   |      12 |           11.5
   shared/types/premium.ts                            |      12 |           11.5
   client/screens/ProfileScreen.tsx                   |      12 |           11.5
   client/screens/ScanScreen.tsx                      |      12 |           11.5
   server/storage/community.ts                        |      11 |           10.6
   client/navigation/RootStackNavigator.tsx           |      11 |           10.6
   server/routes/photos.ts                            |      11 |           10.6
   server/routes/recipes.ts                           |      10 |            9.6
   client/types/navigation.ts                         |      10 |            9.6
   server/routes/auth.ts                               |      10 |            9.6
   server/index.ts                                    |      10 |            9.6
   server/services/__tests__/carousel-builder.test.ts |      10 |            9.6
  ```

  **Rediscovers the known coupling**: `server/storage/users.ts` — the file that defines
  `createUser`/`createTestUser` and is exactly what silently breaks when `InsertUser`'s
  `.pick({...})` list in `shared/schema.ts` isn't updated alongside a new column (the
  `database_insert_schema_pick_decoupling` memory this todo's Background cites) — appears
  at support=13, confidence=12.5%. The query surfaced it with zero manual tuning, confirming
  the co-change matrix earns its keep per PG Lab design rail #3.

- **Code review, 2 rounds** (`code-reviewer` + `server-reviewer`, dispatched in parallel
  for round 1). Round 1 found one CRITICAL (both reviewers independently, one with a live
  stacked-query proof): `coupled`'s `--min-support` was spliced into SQL via an _unquoted_
  psql `:minsup` substitution with no validation — `--min-support "0; INSERT INTO canary
VALUES (1)"` executed the stacked INSERT against a scratch DB. Fixed with a
  `[[ "$min_support" =~ ^[0-9]+$ ]]` guard before the value ever reaches the heredoc. Round
  1 also found two WARNINGs, both fixed: `--rebuild`'s `TRUNCATE` ran in a separate
  transaction from the reload (folded into one atomic `BEGIN…COMMIT`), and both
  `--since`/`--min-support` option parsers hung forever on a bare trailing flag with no
  value (`shift 2` is a documented no-op when only one positional param remains — added an
  explicit `[ $# -ge 2 ]` guard to each). Round 2 (re-dispatched `server-reviewer` after the
  first round's response was cut off mid-stream by a server error, then `code-reviewer` for
  a focused fix-verification pass) confirmed all three fixes hold and found one more real
  WARNING against the live `ocrecipes_lab` data: `hotspots`'s SQL `LIMIT 200` ran before the
  existing-file filter, and 30.5% of the real top-200 raw-ranked paths no longer exist on
  disk — raised the limit to 1000 (single-sourced into one `raw_limit` variable after a
  follow-up review note caught it being hardcoded twice) with a stderr diagnostic if fewer
  than 20 survive. All fixes have dedicated regression assertions in the hook test (29
  total). Two SUGGESTION-tier findings were deliberately left as-is: `coupled` doesn't
  filter deleted/renamed paths the way `hotspots` does (matches the todo's AC as literally
  written — only `hotspots`'s bullet mentions "filtered to existing files"), and
  `repo.co_change_pairs`'s O(n²) self-join for a hypothetical mega-commit (documented in a
  schema comment, "not observed as a problem" per the reviewer's own words).
- Verification: `npm run check:types` (clean), `npm run lint` (0 errors, 1 pre-existing
  unrelated warning in `coverage-ratchet.ts`), `npm run test:run` (401 files / 5821 tests,
  all passing), `scripts/run-hook-tests.sh` (18/18 hook self-tests, including the new one).
