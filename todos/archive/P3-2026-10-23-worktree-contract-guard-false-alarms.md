---
title: "Worktree-contract guard: cut the false alarms (same-command release, cp source, leading cd, skill workspace)"
status: done
priority: low
created: 2026-10-23
updated: 2026-10-24
assignee:
labels: [harness, deferred]
github_issue:
human_led: true
---

# Worktree-contract guard: cut the false alarms (same-command release, cp source, leading cd, skill workspace)

## Summary

27 of the worktree-contract guard's 39 real-world blocks were false alarms. Fix the four causes, cheapest
and safest first. Every real catch must still be denied.

## Background

Classified on 2026-10-23 (`todos/archive/P3-2026-10-23-classify-worktree-contract-blocks.md`). Scope:
transcripts since 2026-10-12, 796 files including subagents, each denied `tool_use_id` counted once. That
gives **39 blocks in 12 sessions**. One more needle hit was a grep whose output quoted the message, and
it is excluded.

| Label       | Blocks | Cause                                                                                                                                                                                              |
| ----------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| real catch  | 5      | Write tool put a new todo or spec into the main checkout instead of the worktree (#12, #18, #30, #35, #36)                                                                                         |
| real catch  | 2      | `git checkout --detach` of the main checkout, a workaround for the PR-guard bug fixed in #1436 (#24, #25)                                                                                          |
| false alarm | 15     | `scripts/declare-worktree.sh --remove/--clear` **earlier in the same command**, then git work in main. The guard judges the whole command before anything runs, so the release hasn't happened yet |
| false alarm | 5      | Appends to the gitignored skill workspace `<main>/.superpowers/sdd/…` (superpowers SDD progress/report files)                                                                                      |
| false alarm | 4      | `cd <worktree> && … git rm/mv/-C . stash list`. Git segments are judged against the session cwd; the leading `cd` isn't followed                                                                   |
| false alarm | 3      | `cp <main>/x <relative-dest>` from a worktree. `git-safety.sh:849` runs `emit_write_targets` in plain mode, which takes the last **absolute** path as the destination, here the source             |
| unclear     | 5      | `git pull --ff-only` (or branch cleanup) in main while a contract is still live (#1, #3, #26; #6, #7 with a second worktree still registered)                                                      |

The decision holds in the harshest re-counting: all 5 unclear blocks counted as real gives 27 vs 12;
the 15 same-command releases not counted as false alarms gives 12 vs 7.

**The 10-block session (49fc7154) had several causes, not one:** a multi-day superpowers SDD run with two
worktrees registered while the session also did main-checkout chores. Its blocks were 3 SDD-workspace
appends, 2 untracked `cd`, 2 detaches, 1 spec Write, 1 pull and 1 same-command release.

Also found during replay: `stash` is on `MUTATING_GIT_VERBS` with no subcommand check, so a read-only
`git stash list` / `git stash show` in main is denied.

## Fixture corpus (replay through the real hook)

Paths: `M` = main checkout, `W` = registered worktree. Git cases need paths outside `allowlisted()`; the
guard allowlists `/var/folders/*`, so a `mktemp -d` fixture silently allows everything (use fake
`/Users/x/...` paths as `test-git-safety.sh` does). Every Bash row below was replayed through
`git-safety.sh` on 2026-10-23 and DENIES today. The Write-tool row is the file guard, taken from the
transcripts.

| Row     | cwd | Command                                                               | Today | Wanted                                                                  |
| ------- | --- | --------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------- |
| control | M   | `git commit -m x`                                                     | DENY  | DENY                                                                    |
| control | W   | `cp .env $M/.env`                                                     | DENY  | DENY                                                                    |
| real    | W   | Write tool → `$M/todos/P3-x.md`                                       | DENY  | DENY                                                                    |
| real    | M   | `git checkout -q --detach <sha>`                                      | DENY  | DENY                                                                    |
| cp-src  | W   | `cp $M/.env .env`                                                     | DENY  | ALLOW                                                                   |
| cp-src  | M   | `cd $W && cp $M/todos/a.md todos/`                                    | DENY  | ALLOW                                                                   |
| cd      | M   | `cd $W && git rm -q a.txt`                                            | DENY  | ALLOW                                                                   |
| cd      | M   | `cd $W && python3 - <<'EOF' … EOF` + newline + `git mv a b`           | DENY  | ALLOW                                                                   |
| cd-neg  | M   | `cd $W && cd $M && git commit -m x`                                   | DENY  | DENY                                                                    |
| stash   | M   | `git stash list`                                                      | DENY  | ALLOW                                                                   |
| release | M   | `bash scripts/declare-worktree.sh --remove $W; git pull -q --ff-only` | DENY  | DENY, with a message saying to run the release as its own command first |
| sdd     | W   | `echo x >> $M/.superpowers/sdd/p/progress.md`                         | DENY  | owner decides (see below)                                               |

## Acceptance Criteria

- [x] **Message only (no accept change):** the violation text says `--remove/--clear` takes effect only
      once it has run, so run it as its own command first. This targets the 15 same-command blocks.
- [x] **cp/mv destination:** when the last word of a `cp`/`mv` segment is a relative path, the absolute
      source is not reported as the target. A relative destination after `cd` is already a documented
      residual, so this opens no new bypass class.
- [x] **Leading cd:** exactly one leading `cd <absolute-path>` joined by `&&` (and no later `cd`/`pushd`)
      sets the cwd that the git-segment check uses. Reuse the leading-cd parse already behind
      `_GS_CD_BYPASS_RE`. `cd $W && cd $M && git commit` still denies.
- [x] **stash:** `git stash list|show` is not treated as mutating; `git stash`, `push`, `pop`, `apply`, `drop`
      and `clear` still are.
- [x] **`.superpowers/` workspace:** ask the owner whether the gitignored `<main>/.superpowers/` skill
      workspace is allowed like `/audit`'s writes, or stays denied. Implement the answer; record it in
      `docs/harness-residuals.md` if it stays denied.
- [x] Every corpus row above is a row in `.claude/hooks/test-git-safety.sh` (or `test-write-targets.sh`
      for parser rows), and the real-catch and control rows still DENY.
- [x] Old-vs-new differential over the existing `test-git-safety.sh` / `test-write-targets.sh` corpora
      shows **zero DENY→ALLOW** outside the intended rows.

## Implementation Notes

- `lib/write-targets.sh` is shared with `scripts/pg-lab/session-coord.sh`, which uses `--relative` mode
  (already right for `cp <abs> <rel>`). Change only the plain-mode branch, and run both test suites.
- The unclear `git pull --ff-only` rows are out of scope. Pulling main mid-contract is what the contract
  forbids. Leave it denied unless the owner rules otherwise.
- Read `MEMORY-reference.md` → "Guard-work lessons" before editing. Guard edits need auto mode off.

## Scope Contract

- **Mechanisms to use:** existing `split_segments`, `git_c_target`, `_GS_CD_BYPASS_RE` leading-cd parse,
  `emit_write_targets`; nothing new.
- **Files in scope:** `.claude/hooks/git-safety.sh`, `.claude/hooks/lib/write-targets.sh`,
  `.claude/hooks/test-git-safety.sh`, `.claude/hooks/test-write-targets.sh`, `docs/harness-residuals.md`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- Auto mode OFF (guard self-modification).

## Risks

- Following a leading `cd` is the classic partial-parse trap. Honor only the single exact shape, and keep
  everything else on today's cwd rule.

## Updates

### 2026-10-23

- Filed from the worktree-contract block classification (27 false alarms vs 7 real catches).

### 2026-10-24 — done

- Owner ruled `.superpowers/` allowed (2026-10-24). It is exempt in `git-safety.sh` by physical path:
  the deepest existing folder must resolve inside `<main>/.superpowers`, and the target must not be a
  symlink. The file-tool guard is unchanged (recorded in `docs/harness-residuals.md`).
- **Same-command release:** the deny message adds one sentence when the command itself runs
  `declare-worktree.sh --remove/--clear`. What the guard accepts is unchanged.
- **Leading cd:** one `cd <abs> &&` at the start sets the folder the contract judges against. It is
  honored only when nothing after it can change folder unseen (cd/pushd/popd/eval/source/exec/
  builtin/command, any `$`, a backtick, a dot command). This also closes a false ALLOW: `cd <main> &&
git commit` from a worktree session used to pass.
- **stash:** `git stash list|show` with plain arguments is exempt. Any `$`, backtick, redirect or
  second command keeps it denied.
- **cp:** a plain relative destination is resolved against that same folder (or the session cwd when
  the command has no cd at all). When the folder is unknowable, the lib's `--cp-source` gives exactly
  the old reading. `mv` is unchanged on purpose, since it deletes its source in main. The main root
  itself now counts as "in main" (`cp x .` from main, `cp x <main>`).
- **Evidence:** `test-git-safety.sh` 324/324 (+44 rows; RED first: 12 failed). `test-write-targets.sh`
  passes with 4/4 mutants killed. `test-session-coord.sh` passes. The hand-written suite differential
  over 295 payloads changes 10 DENY→ALLOW (the 10 intended rows) and 4 ALLOW→DENY (intended
  tightenings), and nothing else. Two generated corpora:
  - 6,500 leading-cd rows: the only non-stash DENY→ALLOW is the exact honored shape. It found the
    parameter-built `${y}d` cd, now closed.
  - 5,184 cp/mv rows: 150 DENY→ALLOW, all copies into the worktree; 180 ALLOW→DENY, all cp writes
    that really land in main. It found the main-root gap, now closed.
- Residuals recorded: a profile shell function that changes folder after an honored cd (e.g.
  zoxide `z`), and the pre-existing `cp --target-directory=<main>/d` allow.
