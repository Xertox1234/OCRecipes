---
title: "A repo-retarget flag in ROOT position defeats BOTH merge guards — measured, live on main"
status: backlog
priority: critical
created: 2026-09-13
updated: 2026-09-13
assignee:
labels: [deferred, harness, security]
github_issue:
---

# A repo-retarget flag in ROOT position defeats BOTH merge guards

## Summary

Moving `-R`/`--repo` from its documented position (after the subcommand) to **root position**
(between the binary and `pr`) makes both `guard-outward-cli.sh` and `merge-review-guard.sh`
go silent on an immediate, unreviewed PR merge — including a merge of **this** repository.
Both halves are measured: `gh` really accepts that spelling, and both guards really allow it.

## Background

PR #940's body raised this shape and deferred it:

> Whether that is live depends on whether `gh` accepts those flags before the subcommand,
> which was deliberately not established (nobody ran `gh`).

It was established on 2026-09-13. Both halves are now measured rather than assumed.

### Half 1 — `gh` accepts the spelling

Run read-only, against this repository, with no mutation:

```
$ gh -R Xertox1234/OCRecipes pr list --limit 1
942  test(hooks): pin that a stale review record ...  OPEN  ...
$ gh pr list -R Xertox1234/OCRecipes --limit 1      # documented position, control
942  test(hooks): pin that a stale review record ...  OPEN  ...
```

Byte-identical. Cobra strips flags while resolving the subcommand, and the `pr` command
group registers `-R`/`--repo` via `cmdutil.EnableRepoOverride`, so the root-position
spelling reaches the same flag. **This is a functional invocation, not a parse error.**

### Half 2 — both guards allow it

Each row was fed to the hook as a `PreToolUse` JSON envelope on stdin. No outward CLI was
executed. The two control rows are in the table because a probe whose controls do not fire
proves nothing — an earlier run of this same probe returned ALLOW for every row because
BSD `env` takes options _before_ assignments (`env FOO=1 -u BAR cmd` exits 127), so the
hook never ran at all.

| command string fed to the guards        | `guard-outward-cli` | `merge-review-guard` |
| --------------------------------------- | ------------------- | -------------------- |
| bare merge, no flag _(control)_         | DENY                | DENY                 |
| plain `echo hello` _(control)_          | ALLOW               | ALLOW                |
| `-R other/org` in **root** position     | **ALLOW**           | **ALLOW**            |
| `--repo other/org` in **root** position | **ALLOW**           | **ALLOW**            |
| `-R Xertox1234/OCRecipes` root position | **ALLOW**           | **ALLOW**            |
| `-R other/org` in documented position   | DENY                | DENY                 |

Measured on `origin/main` and on `fix/outward-cli-auto-redirect-boundaries` — **identical on
both**, so this is pre-existing and was not introduced by #940.

Probes: `scratchpad/probe-root-repo-flag.sh`, `scratchpad/probe-second-layer.sh` (session
`session_01M8ZLR988fjpgmBzFpMTG1c`). The second-layer probe uses the real PR against an
EMPTY stamp root, so "the gate engaged" and "the gate denied" are the same event.

## Why this is P0 rather than a residual

1. **It is a total bypass, not a narrowed one.** `guard-outward-cli.sh`'s merge block is
   skipped entirely when the occurrence count drops to zero — so `--auto`, `--admin` and the
   repo-retarget check all vanish together, not just the one that was evaded.
2. **It defeats the layer built to backstop the other.** `merge-review-guard.sh` shipped in
   #941 specifically so that a miss in the outward-CLI guard would not be a silent merge.
   Here both miss the same string, so the defence in depth is depth of one.
3. **It works against this repository.** The retarget does not have to point elsewhere;
   `-R Xertox1234/OCRecipes` merges this repo's own PR with no review record required.
4. **It is a spelling a person might reach for innocently.** Unlike the obfuscation families
   in the P1 todo, `gh -R owner/repo pr ...` reads like ordinary, documented usage.

## Acceptance Criteria

- [ ] A merge carrying a repo-retarget flag in root position is DENIED by
      `guard-outward-cli.sh`, for every spelling matched by `_OUT_REPO_FLAG_RE` (`.claude/hooks/guard-outward-cli.sh:944` — the todo originally cited `:899`, which is inside a comment block)
      — `-R`, `--repo`,
      `--repo=x`, `-Rx`).
- [ ] The same spellings are SEEN by `merge-review-guard.sh` — i.e. they reach the
      review-record requirement rather than exiting early at the `!= merge` check.
- [ ] Controls, both directions, in the same run: ordinary prose naming the flag is NOT
      denied, and read-only root-position usage (`gh -R owner/repo pr list`) stays ALLOWED.
- [ ] Corpus rows generated from the product of {flag spelling} × {position} × {subcommand},
      not hand-listed, with the count quoted together with the corpus that produced it.
- [ ] Mutation-verified per mechanism: break each new clause and confirm it reddens only
      its own rows.
- [ ] `Outward-CLI guard corpus` re-pinned and green against **branch ⊕ main**.

## Implementation Notes

**The root cause is upstream of both consumers.** `lib/cmd-detect.sh`'s needle is shaped
`gh[[:space:]]+pr`, which a root-position flag separates. Both guards read through that
library, which is why both miss the same string. The fix therefore belongs in the shared
extractor — widening one consumer leaves the other open, which is this repo's
`widened-extractor-unwidened-consumer-fails-confidently` pattern.

**READ `todos/P1-2026-09-12-merge-review-guard-extractor-miss-is-a-silent-allow.md` FIRST,
and specifically its record of withdrawn attempts.** A predicate over this same extractor
was attempted three times and withdrawn each time, because every version closed its target
family and re-opened the opposite failure one layer up: first `through` and `enough` were
denied, then `$var` and `$5`, then an ordinary commit message that merely described the
gate. See also
`docs/solutions/logic-errors/widening-a-permissive-text-gate-reopens-the-restrictive-failure-2026-09-12.md`
— the two failure directions are **not** equally costly, because a false deny has no
per-command escape and gets the gate switched off.

That asymmetry argues for a _narrow, structural_ fix here rather than another text predicate:
the flag set is closed and well-known (`-R`, `--repo`, and their `=`/glued forms), and it
occupies a defined slot — after the binary, before the namespace. That is a far smaller
grammar than "any rendering that resolves to the binary", and it is the reason this todo is
separable from P1 rather than blocked on it.

**Do not fix this by truncating the clause at the flag.** Truncating the CLAUSE at a
boundary is the reverted 2026-09-05 CRITICAL (it hid a later `${x:---admin}` from the
`$`-sigil mask). Fix what the scan _sees_, not where the cut lands — the same distinction
#940 drew for redirects.

**Related, and deliberately not folded in:**
`todos/P2-2026-09-12-merge-review-guard-does-not-model-the-gh-api-merge-route.md` is the
third route to the same outcome. If the structural slot-based fix above lands cleanly, that
todo is worth re-reading — a `gh api` merge is also "the binary, then something other than
`pr`".

## Scope Contract

- **Mechanisms to use:** widen the SHARED extractor in `.claude/hooks/lib/cmd-detect.sh` so
  a root-position repo-retarget flag does not separate the binary from its namespace; both
  guards then inherit it. No second predicate in either consumer.
- **Files in scope:** `.claude/hooks/lib/cmd-detect.sh`, `.claude/hooks/guard-outward-cli.sh`,
  `.claude/hooks/merge-review-guard.sh`, and their test + corpus files
  (`test-cmd-detect.sh`, `test-guard-outward-cli.sh`, `repro-outward-cli-corpus.sh`,
  `test-merge-review-guard.sh`).
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None blocking. P1 (extractor miss) touches the same library and should be sequenced with
  this one to avoid two simultaneous widenings of a shared extractor that feeds a required
  check — but neither blocks the other.

## Risks

- **Hook edits feed a required check.** The `Outward-CLI guard corpus` job covers
  `.claude/hooks/` and is main's 9th required check, so a careless edit there wedges every
  open PR. Run it against branch ⊕ main, never the bare tip.
- **Widening a shared extractor changes every consumer at once.** `pr-verify.sh` also calls
  `cmd_gh_pr_write_subcommand` / `cmd_gh_pr_ref`; check it before assuming the blast radius
  is the two guards.
- **Over-denial has no per-command escape in the merge gate.** `SKIP_MERGE_REVIEW=1` must be
  set in the launching shell, so a false deny costs a session restart. Pair every new deny
  row with a prose-is-still-allowed row in the same run.

## Updates

### 2026-09-13

- Filed at the user's explicit request after both halves were measured during the #940
  review. Raised from "disclosed in a PR body" to P0 because the outward-CLI guard and the
  merge review gate were confirmed to miss the _same_ string, against _this_ repository.

### 2026-09-13 (later) — PARTIALLY FIXED on `fix/gh-root-position-repo-flag`; STAYS OPEN

`_CMD_GH_GLOBALS` (`lib/cmd-detect.sh`) and `_OUT_GH_GLOBALS` (`guard-outward-cli.sh`) now
model the slot between the binary and its namespace. Both guards DENY all four enumerated
`-R`/`--repo` spellings; read-only root-position usage stays ALLOWED.

> **THIS TODO IS NOT CLOSED, AND THE HEADLINE SHAPE IS STILL LIVE.** Round-6 review measured
> `gh -t x pr merge 42 -R other/org` as **ALLOW on both layers** — a root-position repo
> retarget defeating both merge guards, which is this todo's title. Reproduced independently
> before being accepted. It is PRE-EXISTING (main allows it too), so the branch is a net
> improvement, but the closure must not be read as complete.
>
> **Why the four spellings looked like the whole problem.** `-R`/`--repo` were treated as the
> only root flags taking a separate argument. cobra accepts any flag valid for the TARGET
> subcommand in root position, and `gh help pr merge` lists five more: `-A/--author-email`,
> `-b/--body`, `-F/--body-file`, `--match-head-commit`, `-t/--subject`. An unnamed one leaves
> its VALUE as a non-dash token, the globals run stops there, and the needle never reaches the
> namespace. The four-spelling corpus was a product of dimensions that were thought of, not
> enumerated from the tool — the exact failure this repo records as "a harvest bounds FALSE
> POSITIVES only; CONSTRUCT the adversarial shape".
>
> **To finish it:** generate the corpus from `gh help pr <verb>`, and note that widening
> `_CMD_GH_GLOBALS` also widens what reaches the GRANT-shaped clause cut in
> `guard-outward-cli.sh` — the surface where two live false grants were found in review, so
> that widening needs its own adversarial round rather than riding along.

**Four corrections to this todo, established by reading the files:**

1. `_OUT_REPO_FLAG_RE` is at `:944`, not `:899` (corrected in AC 1 above).
2. _"Both guards read through that library"_ is **false**. `merge-review-guard.sh` does;
   `guard-outward-cli.sh` is a deliberate **fork** with its own `_OUT_*` vocabulary
   (`:25`, `:61`), so it inherits nothing. Both files had to be widened separately. The
   Scope Contract's "both guards then inherit it" is wrong; its _Files in scope_ list,
   which already named both, is right.
3. The Implementation Notes imply five needles in `guard-outward-cli.sh`. There are
   **seven**, and the two the todo does not mention are the load-bearing ones:
   `gh_pr_clause_has_repo`'s own clause regex at `:1022` — the site the repo-retarget deny
   actually depends on — and `_GH_API_CUT` (the consumer paired with
   `GH_API_RE`; re-derive its line — later commits on the branch moved it). Verified by deny REASON, not merely by "it denied": every root-position
   spelling is caught by the retarget check, which wins over `--auto`.
4. **AC 2 is unreachable as literally worded.** It asks that the spellings "reach the
   review-record requirement". A retarget makes the PR number unresolvable _by design_, so
   the path ends at the unresolvable-PR deny (`merge-review-guard.sh`'s "could not resolve a PR number" branch) instead.
   Satisfied on intent — no longer a silent allow — and a redirect row with a resolvable
   number was added to demonstrate the stage-3 path as well.

**What IS closed, all measured against the merge-base guard:**

- `cmd_is_gh_pr_create` feeds `pr-preflight-guard.sh`, so the same spelling skipped the
  **PR-preflight stamp gate** outright.
- `gh -R owner/repo pr close 42` was likewise allowed. Measured against the merge-base
  guard (`e50a5d08`): `close` and `merge` both ALLOW -> DENY.
- P1 mechanism (b) (a redirect in the same slot) is closed **inside `cmd-detect.sh`**; its
  tripwire row in `test-merge-review-guard.sh` is converted to a deny row. P1's other three
  mechanisms were re-measured and are **still open**, still pinned ALLOW.

**One defect found in the regex this todo asked to change, fixed here on the user's
instruction** (it is a different mechanism, so it is named separately for attribution):
`cmd_gh_pr_ref`'s retarget refusal scanned `$full_match`, whose greedy tail backtracks off
a **trailing** flag to end on the ref. `gh pr merge 42 --repo other/org` therefore resolved
ref 42 and the gate classified the **local** PR #42 — its deny text byte-identical to a bare
merge's. The sibling ordering refused correctly, which is why it survived. The refusal now
scans the clause. `merge-review-guard.sh`'s "This mirrors the Bash arm" paragraph asserted this refusal was unconditional;
that comment is corrected.

Follow-up filed:
`todos/P3-2026-09-13-git-safety-re-derives-the-gh-pr-close-needle-instead-of-using-the-shared-library.md`.
