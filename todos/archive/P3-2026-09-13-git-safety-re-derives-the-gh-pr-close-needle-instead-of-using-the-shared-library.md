---
title: "git-safety.sh re-derives the `gh pr close` needle on raw $CMD instead of using the shared extractor, so a root-position repo flag skips its advisory"
status: done
priority: low
created: 2026-09-13
updated: 2026-09-13
assignee:
labels: [deferred, harness]
github_issue:
---

# `git-safety.sh` re-derives a needle the shared library already owns

## Summary

`git-safety.sh:559,561` carries its own hand-written copy of the `gh pr close` needle,
matched against **raw `$CMD`** with no quote-aware rendering and no globals slot. A
root-position repo flag (`gh -R owner/repo pr close 42`) therefore skips its
unmerged-branch advisory. The destructive action itself is **denied** by
`guard-outward-cli.sh`, so this is a missing warning, not an open bypass.

## Background

Found while closing
`todos/archive/P0-2026-09-13-repo-retarget-flag-in-root-position-defeats-both-merge-guards.md`.
That P0 widened `lib/cmd-detect.sh` and `guard-outward-cli.sh` so a flag sitting between
the binary and its namespace no longer hides the invocation. `git-safety.sh` inherited
nothing, because it never sourced the library:

```
559: elif printf '%s' "$CMD" | grep -qE '(^|[;&|[:space:]])gh[[:space:]]+pr[[:space:]]+close[[:space:]]+'; then
560:   KIND="delete"
561:   REF=$(printf '%s' "$CMD" | sed -nE 's/.*gh[[:space:]]+pr[[:space:]]+close[[:space:]]+([^[:space:];&|]+).*/\1/p')
```

Verified 2026-09-13 that the file contains no `. …/lib/cmd-detect.sh` line, so this is a
re-derivation rather than a consumer that needs re-widening.

`.claude/agents/code-reviewer.md:187` names this exact shape — a hand-rolled command needle
alongside a shared quote-aware scanner — as the smell the library exists to eliminate.

## Why this is LOW, not a security finding

Measured 2026-09-13 by running the merge-base guard and the fixed guard against the same
envelope, no outward CLI executed:

| command                       | `guard-outward-cli` @ `e50a5d08` (pre-fix) | `guard-outward-cli` @ this branch |
| ----------------------------- | ------------------------------------------ | --------------------------------- |
| `gh -R other/org pr close 42` | ALLOW                                      | **DENY**                          |
| `gh -R other/org pr merge 42` | ALLOW                                      | **DENY**                          |

So the P0 fix already closed the reachable half. What remains is that `git-safety.sh`'s
advisory — the "this closes a PR whose branch may be unmerged" warning, which calls
`warn()` and never blocks — does not fire on that spelling. A missing warning behind a
hard deny.

The second, larger half is that the same file also models **no quote-aware rendering at
all**, so `g"h" pr close 42` and friends miss too. That is pre-existing and unrelated to
root position; it is the reason to port rather than patch.

## Acceptance Criteria

- [x] `git-safety.sh` detects `gh pr close` through `lib/cmd-detect.sh` rather than its own
      raw-`$CMD` needle, so it inherits the quote-aware rendering and the globals slot.
- [ ] The advisory fires for all four root-position spellings (`-R v`, `--repo v`,
      `--repo=v`, `-Rv`) and for a quoted binary rendering.
      **Partially met — see 2026-09-14 Updates entry.** The four root-position spellings
      are fully met (each fires the SKIP_REASON path). "A quoted binary rendering" is
      NOT met and is not achievable within this todo's own Scope Contract; pinned as a
      measured, tested residual instead of silently dropped.
- [x] Two-sided in the same run: ordinary prose naming the verb, and a read-only
      `gh -R owner/repo pr view 42`, do NOT trigger the advisory.
- [x] `test-git-safety.sh` covers both directions; its assertion-total pin is updated
      deliberately.
- [x] Mutation-verified: reverting the new detection leaves only its own rows red.

## Implementation Notes

- `cmd_gh_pr_write_subcommand` already returns `close`, and `cmd_gh_pr_ref` already returns
  the ref with the retarget refusal applied — so the port is mostly deleting the two
  hand-written lines and reading the library's answer instead. Note `cmd_gh_pr_ref` REFUSES
  (rc 1) on a retarget, which for this advisory means "cannot name the branch" — route that
  to the existing `SKIP_REASON` path rather than to a wrong branch name.
- `git-safety.sh` must keep working when the lib is unsourceable. It is an advisory hook,
  so the safe direction there is silence, matching `pr-verify.sh`'s `|| exit 0`.
- `.claude/hooks/**` feeds the **required** `Outward-CLI guard corpus` check. Run it against
  **branch ⊕ main**, not the bare tip.

## Scope Contract

- **Mechanisms to use:** the existing `lib/cmd-detect.sh` functions. No new detector, no new
  constant.
- **Files in scope:** `.claude/hooks/git-safety.sh`, `.claude/hooks/test-git-safety.sh`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. The P0 it was found under is already fixed; this is the un-ported sibling.

## Risks

- `git-safety.sh` has 126 pinned assertions; sourcing the lib changes what the detector sees
  for every existing row, not just the new ones. Re-run the whole file, not the new section.
- Over-firing an advisory is cheap (a warning), but this hook shares `KIND="delete"` with
  the `git branch -D` / `git push --delete` paths — do not widen those by accident.

## Updates

### 2026-09-13

- Filed while closing the root-position P0, at the user's direction to surface rather than
  fold in: different verb, different file, and it needs porting onto the shared library,
  which is its own change.

### 2026-09-14 — implemented, branch `worktree-agent-af29a722ea3889e38` (to be renamed

`todo/P3-2026-09-13-git-safety-re-derives-the-gh-pr-close-needle-instead-of-using-the-shared-library`)

- **Implemented as specified**: `git-safety.sh`'s `gh pr close` detection now calls
  `cmd_gh_pr_write_subcommand`/`cmd_gh_pr_ref` from `lib/cmd-detect.sh` instead of its own
  raw-`$CMD` needle, gated strictly on `= "close"`. All four root-position spellings fire
  the advisory (via the existing `SKIP_REASON` path, since `cmd_gh_pr_ref` refuses to name a
  ref across a `--repo`/`-R` retarget — it cannot convey a second repository).
- **AC #2's "quoted binary rendering" clause measured UNACHIEVABLE within this todo's own
  Scope Contract** ("the existing lib/cmd-detect.sh functions... No new detector"):
  `cmd_gh_pr_write_subcommand`/`cmd_gh_pr_ref` read `cmd_bare_deep`, which BLANKS quoted
  spans rather than reconstructing them — a binary name split across a quote boundary
  (`g"h" pr close 42`) or a quote-spliced verb (`gh pr clo""se 42`) never re-forms into a
  token either function's regex can match. Closing it would need a `cmd_words`-based
  predicate (the rendering that GLUES quoted spans instead of blanking them) — no such
  predicate exists for `close` in `lib/cmd-detect.sh` today, and adding one is exactly the
  "new detector" the Scope Contract excludes, in a file (`lib/cmd-detect.sh`) that was
  simultaneously being edited by a sibling executor in the same batch. Both gaps are
  pinned as tests (`test-git-safety.sh`: "a quote-glued gh binary... is a known, unfixed
  detection gap", "quote-splicing the verb... is a known, pre-existing detection gap") —
  documented and verified, not silently dropped. The old raw needle never detected either
  shape either (verified directly), so this is not a regression versus `main`.
- **THIRD residual, found in review and previously undisclosed — AC #2's "all four
  root-position spellings" is true only for the BARE forms.** ONE separate-arg global is
  already enough — measured, `gh --hostname github.com pr close 42` with no `-R` present at
  all goes SILENT, because `_CMD_GH_GLOBALS` admits `-R v`, `--repo v` and glued `-x` but no
  other flag-plus-value pair. Stack a SECOND separate-arg
  global onto the retarget flag and `cmd_gh_pr_write_subcommand`'s regex stops matching the
  command at all, so the advisor goes entirely silent — no warning and no `SKIP_REASON`.
  Measured under bash 5.3.15, with the bare and single-flag forms as controls:

  | command                                             | result                   |
  | --------------------------------------------------- | ------------------------ |
  | `gh pr close 42`                                    | advisory fires           |
  | `gh -R other/org pr close 42`                       | "Fresh PR check skipped" |
  | `gh --hostname github.com -R other/org pr close 42` | no output at all         |
  | `gh -R other/org --hostname github.com pr close 42` | no output at all         |

  Inherited from the UNMODIFIED `_CMD_GH_GLOBALS` grammar in `lib/cmd-detect.sh`, whose own
  comments already track this shape as an open residual for its other consumers — so it is
  not introduced by this port, and total silence is within this hook's advisory-only design
  — bounded by **gh itself**, not by a deny backstop. Measured 2026-09-15: both annotated
  forms return BYTE-EMPTY from `guard-outward-cli.sh`, indistinguishable from an `echo hello`
  negative control, while the bare close form returns a full deny. What makes the shape
  harmless is that gh 2.100.0 refuses a pre-verb global — its root FLAGS are only `--help`
  and `--version`, and `gh --hostname github.com --version` returns "unknown flag" — so the
  annotated input cannot execute. An earlier revision credited a DENY that does not exist
  for these two shapes; a wrong reason, not a live hole, and no bypass todo should be filed
  off it. Now
  pinned as a test alongside the other two, because without it "all four root-position
  spellings" reads as full globals-slot coverage, which it is not.

- **Unplanned CRITICAL found and fixed during review** (code-reviewer, round 1):
  `cmd_gh_pr_ref` can return a URL, not just a number or branch name — the reused extractor
  pair's own header comment in `lib/cmd-detect.sh` explicitly warns that reusing it without
  a host-restriction guard turns a redundant local lookup into "network egress to an
  attacker-chosen host," and names `pr-verify.sh`'s `GH_ALLOWED_HOST` guard as the
  precedent to carry forward. The initial port did not carry it. Verified by construction
  (no `gh` invoked): `cmd_gh_pr_ref` on a `gh pr close` mention hidden inside a live
  `"$(...)"` substitution resolves an attacker-controlled URL with `rc=0`. Because this
  hook is `PreToolUse` (fires the instant a command is merely _proposed_, before any user
  permission decision), this would have opened a real network connection to that host.
  **Also discovered while fixing it: the DIRECT (non-hidden) form of this exact hole is
  PRE-EXISTING and LIVE on `main` today** — verified against the unmodified base commit
  (`ac553192`): `git branch -D <url>` already reaches an unrestricted `gh pr view <url>`
  through the _original_ raw-`sed` extractor, since `git-safety.sh`'s five `KIND="delete"`
  branches (`git branch -D`, the long-form `--delete --force` spelling, `git push
--delete`, `git push :ref`, and now `gh pr close`) all share ONE `REF`-processing block
  and ONE `gh pr view "$REF"` call site, and none of the pre-existing REF checks
  (quote-strip, empty-after-normalization, flag-like, `$`/backtick) reject a plain
  `https://` string. The fix (mirroring `pr-verify.sh`'s `GH_ALLOWED_HOST` case statement)
  was applied UNCONDITIONALLY to `REF` right before the shared `gh pr view` call, closing
  the hole for all five branches, not just the newly-ported one. Codified as a third
  instance of `docs/solutions/logic-errors/widened-extractor-unwidened-consumer-fails-confidently-2026-08-06.md`.
- **Review, round 1**: `code-reviewer` found 1 CRITICAL (the URL-egress hole above) + 3
  WARNINGs (a vacuous "close-only gate" test-coverage claim; the todo's exact AC#3 pairing
  untested; a residual-cause comment needing tightening) + 3 SUGGESTIONs. `security-auditor`
  found no findings, plus 1 SUGGESTION (a quote-splicing sibling residual, pinned as a
  test). All fixed.
- **Review, round 2** (cap reached — 2 rounds per `docs/AI_WORKFLOW.md`): re-verified
  against the round-1 fixes. `code-reviewer` confirmed the CRITICAL fix correct via a
  10-case adversarial host-bypass matrix, and found 1 NEW WARNING: the three "close-only
  gate" test rows added in round 1 were genuinely vacuous — none contained a literal
  `close` substring, so none even cleared the file's own `*gh*`+`*close*` pre-source guard,
  meaning the `= "close"` comparison they claimed to pin was never reached. Verified by
  mutation (widening the comparison left those three rows unaffected but is caught by the
  replacement rows). Fixed: replaced with `echo close; gh pr <verb> ...`-shaped inputs that
  genuinely clear the pre-guard while resolving to a different verb.
  `security-auditor` found 1 NEW CRITICAL: the URL host-restriction's disqualify pattern
  (`*://*|*:*`) missed a protocol-relative reference (`//host/path`) — no colon anywhere,
  so it matched neither the allow nor the disqualify arm and reached `gh pr view`
  unrestricted. Verified by construction (`cmd_gh_pr_ref` resolves `//exfil.example.test/...`
  with `rc=0`; matches neither case arm) and fixed by adding a `//*` disqualify arm,
  confirmed safe for the other four `KIND=delete` branches via `git check-ref-format`
  (a git ref name can never contain two consecutive slashes). No round-3 review dispatched
  (cap reached, per process and per explicit advisor guidance) — verified directly instead:
  reproduced the exploit against the real hook file, confirmed the fix closes it, added a
  regression test, and mutation-tested the fix in isolation (reverting only the `//*` arm
  makes exactly the 1 new test row red, 0 unrelated failures).
- **Verification (final)**: 151/151 `test-git-safety.sh` assertions (up from a
  126-assertion baseline; +25 new). Mutation-verified three times total — reverting only
  the base port left exactly 8 rows red; reverting only the initial URL host-restriction
  fix left exactly 2 rows red; reverting only the `//*` disqualify arm left exactly 1 row
  red; 0 unrelated failures in any of the three. Full hook self-test sweep (37 suites)
  green, re-run after every fix round. Full `npm run test:run`/`check:types`/`lint` green
  (the worktree's known `.env`-missing false-red on `server/storage/**` suites was
  diagnosed and ruled out by re-running with a correctly configured `DATABASE_URL`:
  529/529 files, 8408/8408 tests).
