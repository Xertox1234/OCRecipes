---
title: "split_segments flushes on the unquoted `&`/`|` INSIDE a redirect operator, so `git 2>&1 commit` is fractured before any matcher sees it"
status: done
priority: high
created: 2026-09-13
updated: 2026-09-17
assignee:
labels: [deferred, harness, security]
github_issue:
---

# A redirect operator containing `&` or `|` is split in half before the regex runs

## Summary

`git-safety.sh`'s `split_segments` splits a command into quote-aware segments and flushes on
any unquoted `;`, `|`, `&` or newline — unconditionally, with no notion of whether that
character is a control operator or part of a REDIRECT operator. Four redirect families carry
one inside them:

| command                                   | segments produced                 | contract checked? |
| ----------------------------------------- | --------------------------------- | ----------------- |
| `git 2>&1 commit -m x`                    | `git 2>` + `1 commit -m x`        | **no**            |
| `git &>/dev/null commit -m x`             | `git ` + `>/dev/null commit -m x` | **no**            |
| `git >&2 commit -m x`                     | `git >` + `2 commit -m x`         | **no**            |
| `git >\|out commit -m x`                  | `git >` + `out commit -m x`       | **no**            |
| `git 2>/dev/null commit -m x` _(control)_ | one segment                       | yes               |

> 🛑 **THE GAP IS POSITIONAL, NOT PER-FAMILY.** Every row above is an INTERPOSED redirect, and
> an earlier revision of this todo generalised them into a claim about the four operator
> families as such. That is false in the VERB-GLUED position, and the parent PR's own test
> suite already falsified it (`git checkout>&2 -b foo` is an `assert_deny` there). Measured
> across 4 families × 4 positions against both hooks, cwd = main checkout:
>
> | position                                   | `&>`                   | `>&`                        | `>\|`                       | `2>&1`                                      |
> | ------------------------------------------ | ---------------------- | --------------------------- | --------------------------- | ------------------------------------------- |
> | spaced / glued-to-binary / between-globals | OPEN                   | OPEN                        | OPEN                        | OPEN                                        |
> | verb-glued                                 | already denied on main | **closed by the parent PR** | **closed by the parent PR** | correctly allowed — lexes as verb `commit2` |
>
> So this todo's target is **the three interposed positions**, for all four families. Do not
> go after the verb-glued rows: two of them are already green and one of them should be.

Neither half matches `MUTATING_GIT_SEG_RE` — the first has no verb, the second does not start
at `git` — so the segment loop takes its `|| continue` and the worktree contract is never
checked for that command.

**All four are real invocations**, verified by running them against an argv shim that appends
`$*` to a file (not reasoned from the grammar):

```
git 2>&1 commit -m A         -> REAL-INVOCATION argv: commit -m A
git &>/dev/null commit -m B  -> REAL-INVOCATION argv: commit -m B
git >&2 commit -m C          -> REAL-INVOCATION argv: commit -m C
git >|out commit -m D        -> REAL-INVOCATION argv: commit -m D
```

## Background

Found while implementing
`todos/archive/P1-2026-09-13-a-redirect-between-git-and-its-verb-defeats-the-worktree-contract.md`,
which adopted `lib/cmd-detect.sh`'s `_CMD_GIT_GLOBALS` / `_CMD_POS_SUFFIX` and closed the
interposed and verb-glued redirect positions. That change is correct and landed; it simply
cannot reach these four families, because the fracture happens one layer ABOVE the regex.

**How it was missed there, and the reason to state it here:** that todo's corpus measured
`grep -qE` against the constant in isolation. Through the real two-stage pipeline
(`split_segments` THEN the regex) the same 1344 rows score 912 SEEN, not 1200. The two
numbers were indistinguishable because 1200 is _also_ the count of corpus rows that are real
invocations, so the table read as a perfect score. Measure at the layer the claim is about.

### Scope: which consumers are affected

`split_segments` is local to `git-safety.sh` (it is not in `lib/`), so the fracture is this
hook's alone. `lib/cmd-detect.sh`'s own `cmd_words`-based matchers do NOT use it, and
`cmd_is_git_commit 'git 2>&1 commit -m y'` returns SEEN — measure before assuming a sibling
hook shares the gap, and before assuming it does not.

## Severity note

Filed **high**, matching its parent. It is an active bypass of a live control. It sits below
the merge-gate P0s for the same reason the parent did: the worktree contract prevents
accidental cross-checkout mutation during isolated work and has a sanctioned one-shot escape
(`SKIP_WORKTREE_CONTRACT=1`), so this is an undocumented route to something a caller may
legitimately ask for — not an unreviewed merge to `main`. Bump it if you weigh the isolation
guarantee higher.

## Acceptance Criteria

- [x] A mutating git command whose redirect operator contains `&` or `|` reaches the contract
      check with its segment intact, for all four families (`2>&1`, `&>`, `>&`, `>|`) **in the
      three INTERPOSED positions** (spaced, glued-to-binary, between-globals). The verb-glued
      position is out of scope — see the positional table above; two of its four cells are
      already denied and the third correctly is not.
- [x] **No segment is merged that was previously separate.** This is the criterion the whole
      todo turns on — see Risks. A differential over a corpus that includes genuine control
      operators must show ZERO change in segment COUNT for every command whose `&`/`|` is a
      real separator.

      **REFINED AT IMPLEMENTATION, and NOT met as literally written — read this before
      treating the box as satisfied.** Raw segment COUNT is the wrong invariant for a row
      carrying BOTH a redirect-`&` and a separator-`&`, e.g. `git commit >&out & git commit -m
      y`. The old splitter FRACTURED the first command into `git commit >` + `out `; the new
      one keeps it whole and still splits at the real separator, so the count legitimately
      drops 4 → 3 on a row whose `&` is a real separator. Two corpus rows do exactly this. The
      property that actually protects the gate is that no real command loses its segment-
      INITIAL position, because `MUTATING_GIT_SEG_RE` is `^`-anchored per segment. Measured on
      that invariant instead: 16 rows change count (all un-fracturing) and **0 rows lose a
      segment-initial `git`**, including both mixed rows.

- [x] Laundering controls, constructed not harvested: `git -C <worktree> status && git -C
<main> commit -m x` must still DENY, and every existing compound/laundering row in
  `test-git-safety.sh` must stay green.
- [x] The four `KNOWN-WRONG (filed)` rows in `test-git-safety.sh` flip to `assert_deny` and
      lose the KNOWN-WRONG label, in the same change that fixes the cause.
- [x] Corpus generated from a product of dimensions, measured through the REAL pipeline
      (`split_segments` then the regex), never the regex alone — the parent's mistake.
- [x] Mutation-verified: revert the fix and confirm only the four families **in the three
      interposed positions** redden. Stated as "the four families" it will not hold — the
      verb-glued `>&` and `>|` rows are already green without this fix and would not move.
- [x] Full hook suite green; the `Outward-CLI guard corpus` required check reproduces its pin.

      These are TWO DIFFERENT ARTIFACTS with similar names and an earlier revision of this
      line cited the wrong one, so both are named explicitly:

      - **The required check** is `.claude/hooks/repro-outward-cli-corpus.sh` (`ci.yml:151`).
        Run locally on this branch, exit 0:
        `✓ pin: rows=940  precise-path gaps=62  all-path gaps=324; precise manifest exact;
        all-path manifest exact INCLUDING per-path verdicts; precise-subset-of-all-path holds;
        all 787 deny reasons attributed to the same checks as the pin`.
      - **The hook SUITES** (not the required check): git-safety 262/0, cmd-detect 659/0,
        guard-outward-cli 822/0, merge-review-guard 131/0, branch-preflight 72/0,
        drift-detect 36/0, guard-worktree-isolation 23/0, core-bare-guard 9/0. Listed
        individually because the matcher half edits a SHARED constant in `lib/cmd-detect.sh`,
        so "the hook suite" alone would not have been the right denominator.
      - **The EXTRACTOR, which no suite above constrains.** `_CMD_GIT_GLOBALS` also carves a
        span for `cmd_git_repo_dir`'s `grep -oE`, and widening is monotone on a boolean read
        but NOT on an extractor — its answer feeds `branch-preflight.sh`, `drift-detect.sh`
        and `drift-detect-update.sh`, the last of which the lib flags as the consumer where
        over-matching SUPPRESSES a baseline write rather than failing safe. Diffed on the
        EXTRACTED ANSWER over the same 884 commands: **0 changed**. That zero has a
        denominator — 204 of the rows return a real path (95 the worktree, 95 main, plus
        glued-value artifacts), so the probe entered the regime rather than answering
        uniformly.

## Implementation Notes

The awk scanner's state-0 branch is the whole of it:

```awk
else if (c == ";" || c == "|" || c == "&" || c == "\n") { flush() }
```

It needs to distinguish a control operator from a redirect operator. The discriminator is
lookaround, which this scanner does not currently do: `&` is part of a redirect when it is
immediately followed by `>`/`<` (`&>`), or immediately preceded by `>`/`<` (`>&`, `2>&`);
`|` is part of one when immediately preceded by `>` (`>|`). Everything else is a separator.

**`lib/cmd-detect.sh` already encodes this distinction** — `_CMD_REDIR` spells the operator
as `&?[<>]+&?[|!]?` precisely so the surrounding `&`/`|` are consumed as part of one unit.
Derive the lookaround from that constant's shape rather than inventing a second grammar; the
parent todo exists because a consumer re-derived a redirect grammar locally.

Do not reach for "also test the unsplit `$CMD`" as a shortcut. Splitting is what stops a
benign cross-segment `-C` from laundering a main-checkout mutation (see the comment at the
head of the contract branch); testing the whole command as one string re-opens that.

## Scope Contract

- **Mechanisms to use:** teach `split_segments`'s state-0 flush to recognise a redirect
  operator, deriving the shape from `_CMD_REDIR`. No second splitter, no whole-command
  fallback, no change to `MUTATING_GIT_SEG_RE`.
- **Files in scope:** `.claude/hooks/git-safety.sh`, `.claude/hooks/test-git-safety.sh`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- Parent (landed):
  `todos/archive/P1-2026-09-13-a-redirect-between-git-and-its-verb-defeats-the-worktree-contract.md`.
  Its `KNOWN-WRONG (filed)` rows are this todo's regression targets and its corrected corpus
  table is the baseline to beat (912/1344 through the real pipeline).

## Risks

- 🛑 **This is the false-ALLOW direction, unlike its parent.** Widening the REGEX could only
  add DENYs. Narrowing where the SPLITTER flushes does the opposite: two commands that used
  to be separate segments become one, and `MUTATING_GIT_SEG_RE` is `^`-anchored per segment,
  so a `git commit` that follows a merged separator stops sitting at a segment start and goes
  INVISIBLE. A careless fix here is strictly worse than the bypass it closes. Every change
  must be paired with a segment-count differential, not just a verdict differential.
- **Hook edits feed a required check.** `Outward-CLI guard corpus` covers `.claude/hooks/`
  and blocks every merge. Run it against branch ⊕ current main, never the bare tip.
- **The scanner is quote-stateful.** The `&` that matters is only the state-0 one; an `&`
  inside `'…'`, `"…"` or `$'…'` already survives, and those paths are pinned by existing
  tests. A fix that moves the check out of state 0 would regress them.
- **`{fd}>` is adjacent but NOT in scope** — `_CMD_REDIR` models a `{name}` fd prefix, and
  `{`/`}` are not flush characters, so those rows already pass. Named here so an implementer
  does not widen the change looking for a fifth family.

## Updates

### 2026-09-13

- Filed from the implementation of the parent todo, at the user's explicit direction after
  the finding was surfaced. The fracture, the four affected families, and their status as
  real invocations were each measured — the argv-shim run above — rather than inferred from
  the splitter's source.

### 2026-09-17 — CLOSED

- `split_segments`'s state-0 flush now treats an `&`/`|` **adjacent to `<`/`>`** as part of a
  redirect operator rather than a separator. The adjacency is derived from the
  `&?[<>]+&?[|!]?` shape `_CMD_REDIR` already spells, not from a second local grammar.
- **The discriminator reads `praw`, not `buf[i-1]`** — the last character appended in state 0
  UNQUOTED and UNESCAPED. `echo \>& git -C <main> commit` has a LITERAL `>`, so its `&` really
  is a separator; a naive lookbehind would have merged there and hidden the following command.
  That row is pinned in `test-git-safety.sh` (via `jsonc`, since a lone backslash is not valid
  JSON by hand).
- **The segment-count criterion this todo turned on** was measured, not argued. Raw count is
  the WRONG invariant: a row carrying both a redirect-`&` and a separator-`&` legitimately
  drops one segment because the first command stops being fractured. The invariant that
  matters is that no real command loses its segment-INITIAL position, since
  `MUTATING_GIT_SEG_RE` is `^`-anchored per segment. Over a constructed corpus carrying genuine
  separators: 16 rows change segment count (every one un-fracturing) and **0 rows lose a
  segment-initial `git`**.
- **Mutation-verified per layer.** Reverting only this splitter change reddens exactly 5
  assertions — the four families plus `git -C&>out <main> commit`, which needs the operator
  intact before the tokenizer can read its prefix. Reverting the two value-slot layers reddens
  disjoint sets, so none of the three edits is inert.
- Measured on an 884-row grid (operator × EVERY insertion slot × 3 arg-taking globals ×
  bash/zsh, argv ground truth from a shim): live bypasses 291 → 114 across the whole change,
  **0 DENY→ALLOW regressions**.
- The four `KNOWN-WRONG (filed)` rows are now `assert_deny`, in the same change as the cause.
  Residual class 2 in `git-safety.sh` is marked CLOSED in place (not renumbered — other files
  cite these numbers).
- Landed together with
  `todos/P1-2026-09-16-redirect-in-arg-taking-global-value-slot-defeats-both-git-safety-layers.md`,
  which lists this todo as a blocking dependency: 18 of its 45 value-slot rows were fractured
  here before any matcher could see them.
