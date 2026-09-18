---
title: "The two-token gh needles miscount occurrences through a process substitution, so a hidden second merge is invisible to the ambiguity refusal"
status: blocked
priority: medium
created: 2026-09-14
updated: 2026-09-16
assignee:
labels: [deferred, harness, security]
github_issue:
---

# Two-token gh needles miscount occurrences through a process substitution

## Summary

`guard-outward-cli.sh` refuses a command carrying more than one `gh pr merge` (or `gh api`,
or `gh pr create|comment`) occurrence, because it cannot verify each one independently. A
**process substitution** is absorbed into the span between the binary and its namespace, so a
genuinely-executing second invocation is counted as zero and the refusal never fires.

`gh api` was fixed on 2026-09-13/14 (`_OUT_GH_GLOBALS_SEPSAFE` + a `max()` of two grammars).
The **two-token** families — `pr merge`, `pr create|comment`, `release …`, `repo …` — were
left, because they were believed structurally immune. They are immune to the _value-arm_
collapse; they are **not** immune to this one.

## Measured 2026-09-14

Counted with the guard's own needles, on the branch and on `main` separately:

| command                                 | merge occurrences                 |
| --------------------------------------- | --------------------------------- |
| `gh pr merge 7;gh pr merge 42`          | 2 — the refusal fires             |
| `gh -a -c <(gh pr merge 7) pr merge 42` | **1** on `main` AND on the branch |

**PRE-EXISTING.** `main` and the branch count identically, so the root-position work neither
opened nor closed this.

**No live ALLOW was found.** Five variants — including a real `--auto` on the outer merge with
a decoy `--auto` glued to the hidden inner one, and the reverse ordering — all still DENY. But
they deny on the `without a REAL --auto flag` branch, **not** on the ambiguity branch: the
second merge is invisible to the **counter**.

What refuses is the clause **sigil mask**, by construction: the collapse _is_ the span
absorbing ` <(gh`, so the `(` is necessarily inside the clause.

**Two earlier versions of this paragraph were wrong, and the second was wrong while correcting
the first.** Measured:

```
cmd     gh -a -c <(gh pr merge 7 --auto) pr merge 42 --auto --squash
CLAUSE  [gh -a -c <(gh pr merge 7 --auto]
```

The clause **stops at the closing paren** (`_OUT_POS_SUFFIX_MERGE_CLAUSE`'s continuation class
excludes `)`), so it never reaches the outer merge's arguments. The `--auto` in it is the
**inner decoy**, and the clause is byte-identical whether or not the real merge carries one.

**This changes what the fix has to do.** The mask is load-bearing for the whole family, not for
one row: removing `(` from it also allows `gh -a -c <(gh pr merge 7 --auto) pr merge 42`, where
the executing merge has no authorisation at all. So fixing the COUNT alone is not sufficient —
**the CLAUSE CAPTURE BOUNDARY must be fixed too**, or any later relaxation of the mask
reintroduces this class of false ALLOW. Both shapes are pinned in `test-guard-outward-cli.sh`.

## Mechanism

`_OUT_SEP` — the separator between the binary and its namespace — interpolates the **shared**
`_CMD_REDIR`, whose target class is `[^[:space:];&|)` + backtick + `]+` and therefore **admits
`(`**. A process substitution reads as "a redirect to a file named `(gh`", so ` <(gh pr merge 7)`
is swallowed and the whole string matches as a single occurrence.

This is the same mechanism that defeated the first `gh api` fix, one family over. That fix
narrowed the count-only grammar to `_OUT_POS_PREFIX`'s full anchor set (`[;&|(` + backtick +
`{!]`) and gave it a locally-narrowed redirect arm, `_OUT_SEP_SEPSAFE`.

## Acceptance Criteria

- [ ] `gh -a -c <(gh pr merge 7) pr merge 42` counts **two** merge occurrences and denies on
      the ambiguity reason, on every two-token family (`pr merge`, `pr create|comment`,
      `release`, `repo`).
- [ ] The three tripwire rows in `test-guard-outward-cli.sh` (search `TRIPWIRE: a hidden
second pr merge`) are **converted**, not deleted — they currently pin the miscount's
      current DENY and its reason.
- [ ] Two-sided in the same run: the sanctioned automerge
      (`gh pr merge <n> --auto --squash --delete-branch`) still ALLOWS, and the `;` spelling
      still denies on the ambiguity reason.
- [ ] Generated corpus rows keyed on **command-position openers**, not separators — the axis
      that missed this for `gh api` varied `;&|` only. `.claude/hooks/repro-outward-cli-corpus.sh`
      has the shape to copy (search `apicollapse-`).
- [ ] The fail-closed assertion gains an operand for any new constant, and the needle that
      consumes it is asserted too — the operand/consumer split has now been the finding twice.
- [ ] `Outward-CLI guard corpus` re-pinned green against branch ⊕ main.

## Implementation Notes

The `gh api` fix is the template, in `.claude/hooks/guard-outward-cli.sh` — cite by text, not
line: `_OUT_SEPSAFE_TOK`, `_OUT_SEPSAFE_REDIR`, `_OUT_SEP_SEPSAFE`, `_OUT_GH_GLOBALS_SEPSAFE`,
and the `max()` at `_gh_api_n_wide`/`_gh_api_n_sepsafe`.

**Do not narrow the shared `_CMD_REDIR`.** Its target class admits `(` deliberately and every
consumer of the library reads it. Narrow a copy used at the counting site only.

**Narrowing is safe in the max() direction** — `max ≥ wide` always — so it can only add denies.
That is what makes this approach tractable on a gate where over-denial has a per-command
escape here (`ALLOW_OUTWARD_CLI=1`) but none in `merge-review-guard.sh`.

**Expect the merge family to be touchier than `gh api`.** Its block carries the `--auto`
carve-out, the `--admin` deny and the repo-retarget check, and the count decides whether that
block runs at all (`if -gt 1 / elif -eq 1 / fi`, with no `else`). Raising a count from 1 to 2
moves a command from the carve-out path to the ambiguity deny — which is the intent, but it
will flip currently-allowed shapes, so pair every new deny with the sanctioned automerge row.

## Risks

- `.claude/hooks/**` feeds main's 9th **required** check with no `paths:` filter; a careless
  edit wedges every open PR.
- The `--auto` carve-out is the one grant-shaped read in that file. Two live false grants were
  found there in review during the `gh api` work. Any change near the merge count should be
  measured against it explicitly, not reasoned about.

## Dependencies

None. The `gh api` half is closed
(`todos/archive/P0-2026-09-13-repo-retarget-flag-in-root-position-defeats-both-merge-guards.md`).

## Updates

### 2026-09-14

Filed from round-3 baseline review of PR #957, which asked whether the "two-token families
cannot collapse" claim in that PR's own header covered the `(` mechanism. It did not — it was
true of the value-arm mechanism only. The claim has been scoped in place and the current
miscount pinned as tripwires rather than left undisclosed.

### 2026-09-16 — BLOCKED: AC1 proved unreachable as worded; a more severe, unrelated residual found

**AC1 cannot be satisfied by occurrence counting, for either `pr merge` or `pr
create|comment`, and this is proved rather than merely un-attempted.**

Two repair approaches were implemented, measured, and reverted:

1. **The `gh api` SEPSAFE template** (a separator-safe grammar, `max()`'d against the wide
   count, mirroring `_OUT_GH_GLOBALS_SEPSAFE`/`_OUT_SEP_SEPSAFE`/`_gh_api_n_wide`/
   `_gh_api_n_sepsafe`) is **inert** for this exact shape. Measured: `gh -a -c <(gh pr merge

7) pr merge 42`returns count=1 under BOTH the wide AND a separator-safe grammar built the
same way — the nested invocation's own`gh`is the ONLY`gh`reachable to complete ITS OWN
match; the outer, really-executing`pr merge 42`has no separate`gh`of its own to anchor
a second, non-overlapping`grep -o`match, under any separator narrowing. (The template
DOES work for the ordering the original`gh api`fix targeted — psub AFTER a complete
first occurrence, e.g.`gh pr merge 7 -c <(gh pr merge 42)` — where it is unneeded for the
   two-token families anyway: the wide grammar alone already counts 2 there, because a
   two-token verb's globals arm has only one value slot. The vulnerable ordering is
   specifically psub BEFORE the verb.)

2. **A "does the matched span cross a command-position boundary" check** (denying whenever a
   match's own separator/globals run contains one of `_OUT_POS_PREFIX`'s anchor characters,
   `;&|(` backtick `{!`, after excluding the match's own leading anchor and trailing suffix
   char) was implemented next. It correctly converted all three TRIPWIRE rows to deny on the
   ambiguity reason and covered every command-position opener for both families — but it also
   **reddened 23 unrelated, already-correct assertions** in `test-guard-outward-cli.sh`:
   ordinary interior redirects (`gh pr 2>&1 merge 42`, `gh --auto &> ...`) and glued `;`/`&&`/
   `||` before an UNRELATED, verb-less preceding `gh` invocation (`gh --auto -x;gh pr merge
42`) legitimately contain the same anchor bytes as ordinary redirect/glue syntax, and the
   check could not distinguish that from a genuinely nested second invocation. No narrower,
   still-general signal was found. **Reverted in full** — the guard file is back to
   byte-identical with `main` (`git diff` on `guard-outward-cli.sh` is empty).

Both attempts, the measurements, and the reasoning are written up in
`docs/solutions/logic-errors/widening-is-monotone-on-a-boolean-read-not-on-a-count-2026-09-14.md`
(dedup-updated, not a new file) so a future attempt does not re-derive the same two dead ends.

**AC2–AC6 are therefore also not met**: the three TRIPWIRE rows in
`test-guard-outward-cli.sh` are intentionally left UNCONVERTED (still pinning the current,
coincidental "without a REAL --auto flag" / "with --repo/-R" denial), with an updated comment
explaining why conversion was tried and reverted. No new corpus axis was added for the
two-token families for the same reason. Two stale-prose spots WERE fixed in the same change
(cheap, correct, in scope): the corpus comment at `repro-outward-cli-corpus.sh`'s
`apicollapse-*` header, which claimed the two-token families are "structurally immune"
without scoping that to the value-arm mechanism only; and the guard header's pointer to this
todo, which no longer says "still open" without qualification.

**Release/repo need no fix, confirmed by measurement, not assumption.** `GH_MUTATING_RE`
(covering `release`/`repo`/other `pr` verbs) is a plain boolean `grep -Eqi` deny-on-any-match
with no occurrence-count ambiguity concept at all, so the miscount mechanism (which only
affects a COUNT consumer) cannot create a false ALLOW there. Swept across all 9
command-position openers (`;&|(` backtick `{!` `<(` `>(`) in the same psub-before-verb
shape for both families: 18/18 DENY, no exceptions.

**A more severe, unrelated finding surfaced while testing this, on a family explicitly
out of this todo's scope (`gh api`, single-token) and NOT fixed here:**

```
gh -a -c <(gh api /x) api -f merge_method=squash /repos/o/r/pulls/42/merge
```

This is **ALLOWED** by the unmodified guard on `main` (measured from inside
`.claude/hooks/` so `$HERE`-relative `lib/` sourcing resolves correctly — a `/tmp` copy of
the file gives a false verdict via a different code path entirely, see the solution doc's
process note). It is a field-based (`-f`, no `-X` token) mutating `gh api` call at a PR-merge
REST endpoint.

**CORRECTED 2026-09-17 — the attribution above was wrong, and the ordering is
irrelevant.** An earlier revision of this paragraph blamed the psub-before-verb ordering and
claimed the family had never been measured that way. Both were false, established
independently twice (by the orchestrator re-measuring, and by this PR's own reviewer):

- The plainest possible spelling — **no process substitution, no root flags, no occurrence
  ambiguity** — allows identically: `gh api -f merge_method=squash /repos/o/r/pulls/42/merge`,
  and likewise with `-F`, `--field`, `--raw-field`. In the same run,
  `gh api -X POST -f merge_method=squash ...` correctly DENIES on the mutating-method reason.
- So the escape has nothing to do with occurrence counting, grammar narrowing, or psub
  placement. The real mechanism is that the mutating-method check only recognises a literal
  `-X`/`--method` token, and is blind to `gh api`'s documented behaviour of sending POST
  automatically whenever field flags are present. The method is never spelled out, so the
  check never sees one.
- It is also **not novel**. The identical bare form is already pinned as pre-existing on
  `main` in `test-guard-outward-cli.sh` ("the ONE-command -f mutation is allowed here, as it
  is on main (pre-existing)"), about 35 lines below this PR's own tripwire block, attributed
  there to an archived `status: done` todo about a different hook.

Now filed with the correct attribution as
`todos/archive/P1-2026-09-16-gh-api-field-mutation-passes-both-merge-guards.md` (PR #986), which also
retracts the archived todo's stale "not currently a live bypass" line. **Do not re-derive
occurrence-counting or grammar work for it** — that is the dead end this correction exists to
prevent.

**Status set to `blocked`, not `done` or `archived`.** The stated acceptance criteria are
not met. One decision remains: whether to accept the tripwire-pinned residual as the
permanent posture for the two-token families, closing this todo as documentation.

The REST merge-route finding this investigation surfaced is **already resolved as a tracking
question** — it is filed as
`todos/archive/P1-2026-09-16-gh-api-field-mutation-passes-both-merge-guards.md` (PR #986, merged),
with the corrected attribution. Do not call it a "psub-before-verb" finding: as the CORRECTED
note above records, the ordering is irrelevant to it and the plainest spelling reproduces
it.
