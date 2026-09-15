---
title: "A repo-retarget flag in ROOT position defeats BOTH merge guards — measured, live on main"
status: done
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

- [x] A merge carrying a repo-retarget flag in root position is DENIED by
      `guard-outward-cli.sh`, for every spelling matched by `_OUT_REPO_FLAG_RE` (`.claude/hooks/guard-outward-cli.sh:944` — the todo originally cited `:899`, which is inside a comment block)
      — `-R`, `--repo`,
      `--repo=x`, `-Rx`).
- [x] The same spellings are SEEN by `merge-review-guard.sh` — i.e. they reach the
      review-record requirement rather than exiting early at the `!= merge` check.
- [x] Controls, both directions, in the same run: ordinary prose naming the flag is NOT
      denied, and read-only root-position usage (`gh -R owner/repo pr list`) stays ALLOWED.
- [x] Corpus rows generated from the product of {flag spelling} × {position} × {subcommand},
      not hand-listed, with the count quoted together with the corpus that produced it.
- [x] Mutation-verified per mechanism: break each new clause and confirm it reddens only
      its own rows.
- [x] `Outward-CLI guard corpus` re-pinned and green against **branch ⊕ main**.

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
the slot is well defined — after the binary, before the namespace — which is a far smaller
grammar than "any rendering that resolves to the binary", and it is the reason this todo is
separable from P1 rather than blocked on it.

> **CORRECTION, 2026-09-13 — the sentence that used to stand here was the false premise this
> todo was fixed against, and it is left named rather than silently deleted.** It read: "the
> flag set is closed and well-known (`-R`, `--repo`, and their `=`/glued forms)". It is not
> closed. cobra accepts any flag valid for the TARGET subcommand in root position, so the set
> is not a property of `gh` at all — it is whatever flags the following verb defines.
> `gh help pr merge` lists five separate-arg flags besides `-R`: `-A/--author-email`,
> `-b/--body`, `-F/--body-file`, `--match-head-commit`, `-t/--subject`. Measured on both
> layers: `gh -t x pr merge 42 -R other/org` is ALLOWED by both, which is this todo's
> headline shape.
>
> The four spellings named above were closed and are pinned. They looked like the whole
> problem because that list came from the flags that MEAN "retarget", while the grammar cares
> only about which flags CONSUME A FOLLOWING TOKEN — a property of the tool's flag table, not
> of anyone's model of intent. **Whoever finishes this: derive the set from
> `gh help pr <verb>`, not from this file and not from memory.** The reusable form of the
> mistake is codified in
> `docs/solutions/logic-errors/an-invented-enumeration-is-not-the-space-ask-the-tool-2026-09-13.md`.

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

### 2026-09-13 (final) — CLOSED on `fix/gh-root-flag-property-arm`

The remaining half is closed. `_CMD_GH_GLOBALS`'s generic arm now optionally consumes a
following NON-dash token, so a root-position flag that takes a separate argument no longer
leaves that argument sitting where the namespace belongs.

**What actually changed is one alternation arm**, from `-[^[:space:]]+` to
`-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?`. `guard-outward-cli.sh` inherits it
by reference. `_OUT_GH_GLOBALS_GRANT` — the separator-safe form feeding the ONE clause cut
whose downstream check decides an ALLOW — deliberately did **not** get the value arm, because
widening there is a false GRANT rather than an extra deny.

**Measured `ALLOW → DENY` on BOTH layers**, controls in the same run (`echo hello`
ALLOW/ALLOW; `gh pr merge 42` DENY/DENY before and after):

| command                                                     | before      | after                                   |
| ----------------------------------------------------------- | ----------- | --------------------------------------- |
| `gh -t x pr merge 42 -R other/org` _(this todo's headline)_ | ALLOW/ALLOW | **DENY/DENY**, on the _retarget_ reason |
| `gh -b x pr merge 42`                                       | ALLOW/ALLOW | DENY/DENY                               |
| `gh -A a@b pr merge 42`                                     | ALLOW/ALLOW | DENY/DENY                               |
| `gh -F notes.md pr merge 42`                                | ALLOW/ALLOW | DENY/DENY                               |
| `gh --match-head-commit s pr merge 42`                      | ALLOW/ALLOW | DENY/DENY                               |
| `gh -Z x pr merge 42` _(not a real flag)_                   | ALLOW/ALLOW | DENY/DENY                               |

Still ALLOWED, in the same run: `gh -R o/r pr list`, `gh -t x pr view 42`, a commit message
naming the shape, `cp -R src dst`. `pr-preflight-guard.sh` now gates every root-flag
`pr create` spelling (measured, with `gh pr list` / `echo hello` as ungated controls).

**The `-Z` / `--not-a-real-flag` rows are the load-bearing ones.** Neither exists in any `gh`
version, so they pass only against a grammar that models the PROPERTY — "this token may
consume the next one" — rather than a membership list. That is the correction this todo was
reopened for: the flag set is per-verb and open-ended, so it cannot be enumerated, and a
longer list would have gone stale the next time `gh` shipped a flag.

**Accepted, stated over-denial.** Because the grant form stayed narrow, a root flag on an
otherwise-sanctioned automerge (`gh -t x pr merge 42 --auto --squash`) finds no clause and
denies. That direction has a per-command escape here (`ALLOW_OUTWARD_CLI=1`) and the merge
gate has none, so it is the correct trade — pinned as a deny row next to the row proving the
sanctioned shape itself still allows.

**Verification** (figures as of the closing merge; the LIVE values are the pins themselves —
`EXPECTED_TOTAL` in each suite and `EXPECTED_ROWS` in the corpus — and this line has gone
stale three times during review, so read the pins, not this sentence).
631 / 735 / 95 assertions across the three suites; corpus 602 → 739 rows
with a new generated `ghrootv-*` axis (8 flags × 6 families, members derived from
`man gh-pr-<verb>` plus two that do not exist), no NEW precise-path gaps (the pin is unchanged
at 31), and **nothing removed**
from either membership manifest — the check that says no pre-existing row changed behaviour.
Every assertion operand was mutation-verified with both an unmutated control and a
forced-fire control; the negative control confirms a strictly-narrower healthy definition
stays silent, which both earlier counting versions failed.

**One assertion operand was RETIRED rather than repaired.** It was a fixed-string test for the
wide form's generic arm as spelled that day; re-spelling that arm made the literal occur in
neither constant, so it could not fire against any input — inert while green. A behavioural
operand replaced it, and the mutant it was meant to catch is now covered by the separator
probe (measured, not assumed).

**Still open, and NOT closed by this change** (re-measured, not carried forward): the quoted
root flag with a separate unquoted value (`gh "-t" x pr merge 42`) — `cmd_bare` blanks the
span, removing the dash token the value arm anchors on, so this family GREW with this change;
the namespace→verb redirect slot; and P1's binary-rendering families. All tracked in
`todos/P1-2026-09-12-merge-review-guard-extractor-miss-is-a-silent-allow.md`, all denied by
`guard-outward-cli.sh`, all allowed by the merge gate, none a regression.

**And one the same class, ONE SLOT OVER — named here because a residual list that omits it
reads as completeness.** `cmd_gh_pr_ref`'s POST-verb flag walker is still a named
enumeration, kept in two separate copies, and `--attach` (a real `gh pr edit` flag) is absent
from both, so its value resolves AS THE REF: `gh pr edit --attach 99 42` resolves `99`. Short
forms of listed flags fail CLOSED there (an accuracy cost, not a gap); unlisted ones resolve
the wrong ref, which is what a future `gh` flag would do the day it ships. Not reachable by a
functional command on the merge gate today, because every value-taking `gh pr merge` flag is
covered and `--attach` belongs to `edit`. Filed as
`todos/P2-2026-09-13-post-verb-flag-walker-still-enumerates-and-keeps-two-copies-of-the-list.md`
and deliberately NOT half-fixed here: adding `--attach` alone would close one member and
leave the class open, which is the exact mistake this todo exists to record.
