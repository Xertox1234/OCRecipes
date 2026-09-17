---
title: "SHAPE 2 ONLY (shapes 1/1b closed 2026-09-17): a parameter expansion in the fd slot defeats the git-safety MATCHER at every slot, and the fix is a cross-guard widening of _CMD_REDIR"
status: backlog
priority: high
created: 2026-09-16
updated: 2026-09-17
assignee:
labels: [deferred, harness, security]
github_issue:
---

# A redirect in an arg-taking global's value slot is invisible to both git-safety layers

> 🟢 **SHAPES 1 AND 1b ARE CLOSED (2026-09-17).** The value slot no longer accepts a bare
> redirect or a brace-fd token: `_CMD_GIT_ARGVAL` in `lib/cmd-detect.sh` admits interposed
> redirects and excludes `<`/`>` from the value, and `git_c_target` classifies redirects and
> brace words BEFORE its `pend` arms. Both layers were fixed in one change and are pinned
> SEPARATELY (`assert_matcher` / `assert_walker`), with mutation proving neither is inert.
>
> 🔴 **WHAT IS LEFT IS SHAPE 2, AND IT IS BIGGER THAN THIS TODO ORIGINALLY FRAMED IT.** Shape 2
> was filed as an fd-slot miss; measured on an 884-row grid it is **slot-INDEPENDENT**, because
> the miss is in the MATCHER and so the whole segment fails to match wherever the operator
> sits. It accounts for **72 of the 114 surviving ALLOW rows** across 12 operator × slot ×
> spacing cells — including the value-slot rows shapes 1/1b would otherwise have closed. The
> other 42 are residual class 3 (redirect GLUED to the binary), which is a separate gap.
>
> ⚠️ **WHY IT WAS NOT DONE IN THE SAME PR.** The fix is to widen `_CMD_REDIR` itself, which is
> consumed by `guard-outward-cli.sh` (`_OUT_SEP`, `_OUT_POS_PREFIX`, `_OUT_GH_GLOBALS_GRANT`),
> `merge-review-guard.sh` (`MRG_SEP`) and two further constants in `lib/cmd-detect.sh`. That
> makes it a cross-guard change whose corpus pins must be re-derived — and PR #980 is currently
> open against `guard-outward-cli.sh` and `repro-outward-cli-corpus.sh` with pins of its own.
> Landing both would be the repo's own documented
> `a-clean-merge-leaves-a-stale-count-pin` failure. **Serialize after #980 merges.**

## Summary

Two shapes, filed together because they are both fd-slot/value-slot misses in the same guard
but fail at DIFFERENT layers. Shape 1: `git -C >out /MAIN commit -m x` is a real `main` mutation (argv: `[-C] [/MAIN] [commit] [-m] [x]`)
that the worktree contract does **not** enforce. Both of `git-safety.sh`'s layers miss it
independently, for two different reasons, so closing either one alone leaves the route open.

## Background

Found during the review of PR #956 (`fix(hooks): see a redirect between git and its verb in the
worktree contract`), which closed the redirect-**between**-`git`-and-its-verb position. This is a
**sixth** redirect position that PR did not cover and that its residual list at
the `NOT CLOSED` residual list in `git-safety.sh` does not name — the omission matters because that list is written to read as
complete ("a residual list naming only one reads as completeness and the omitted one is the live
route"), and this position sits _inside_ the very group PR #956 widened, which is exactly where an
implementer is most likely to assume coverage.

**This is NOT a regression introduced by #956.** `main` allows these rows identically. It is a
pre-existing gap, filed separately so PR #956 stays scoped.

## Evidence

**Structural (verified directly against the files, 2026-09-16):**

- Matcher, the `MUTATING_GIT_SEG_RE=` assignment in `git-safety.sh` — it spells the separate-arg globals as
  `-C[[:space:]]+[^[:space:]]+` (and the same shape for `-c`, `--git-dir`, `--work-tree`). The
  value class `[^[:space:]]+` happily consumes `>out`, so `>out` is eaten _as the `-C` value_.
  What is left is a bare `/MAIN` token, which matches neither the `-[^[:space:]]+` flag arm nor
  `_CMD_REDIR` — so the whole segment falls off the matcher.
- Tokenizer, the `pend` dispatch inside `git_c_target` in `git-safety.sh` — the `if (pend == "C") { fold(w); pend = ""; return }` branch
  sits **above** the redirect-classifying arm at the `index(w, "<")` redirect arm
  (`if (!tnt && (index(w, "<") || index(w, ">")))`). Because `pend` was set by the preceding
  `-C`, the redirect arm is never reached and `>out` is folded as a **relative** `-C` value,
  which then resolves under cwd — the wrong repo.

**Behavioural (measured in the PR #956 security review; reproduce before relying on it):**

- argv ground truth via an out-of-band shim, identical under bash 3.2.57, bash 5.3.15 and zsh 5.9:
  - `git -C >out /MAIN commit -m x` -> `argv: [-C] [/MAIN] [commit] [-m] [x]`
  - `git --work-tree >out /MAIN reset --hard` -> `argv: [--work-tree] [/MAIN] [reset] [--hard]`
  - `git --git-dir >out /MAIN/.git commit -m x` -> `argv: [--git-dir] [/MAIN/.git] [commit] [-m] [x]`
- Against the real hook with the suite's registry fixture, cwd = the registered worktree: all
  value-slot rows ALLOW on both `main` and the #956 branch.
- Two-sided controls held in the same run: `git -C $MAIN commit -m x` DENY on both hooks, and
  `git 2>/dev/null -C $MAIN commit -m x` ALLOW on `main` / DENY on the branch (proving the #956
  adoption was engaged in the probe rather than the harness being inert).

### Shape 1b — the same value slot, with a brace-fd token

Reachable because the guard now knows the brace token class: `git -C {fd} >o <main> commit -m x`,
`git --git-dir {fd} >o <main>/.git commit -m x`, `git --work-tree {fd} >o <main> reset --hard`.

The `pend` arms fire before the brace class, so the brace word is folded as a **relative** value
and resolves under cwd. Measured emissions from `git_c_target`: `c {fd}`, `g {fd}`, `w {fd}` — so
the real `-C <main>` is never mined. `origin/main` allows these identically; a gap, not a
regression. Pinned as KNOWN-WRONG rows.

Whatever fixes shape 1 must cover this spelling too: both are the same value slot, and a fix that
only teaches the matcher about a bare redirect will leave the brace-fd form open.

## Shape 2 — a parameter expansion in the fd slot (matcher-side only)

Distinct from shape 1 and worth keeping separate in the fix: here the **matcher** misses, so the
tokenizer is never consulted at all.

`git ${nope}>o -C <main> commit -m x` and the unbraced `git $nope>o -C <main> commit -m x` both
produce a real main-mutating argv — `[-C] [/MAIN] [commit]` — under **both** bash 5.3.15 and
zsh 5.9, so unlike the brace-fd family this shape does not depend on zsh-only lexing. `_CMD_REDIR`
spells the fd prefix as `([0-9]*|[{]...[}][[:space:]]*)`, which admits neither `${nope}` nor
`$nope`, so `MUTATING_GIT_SEG_RE` never matches the segment.

`main` allows both identically — an un-closed gap, not a regression. Pinned as KNOWN-WRONG rows
in `test-git-safety.sh` and named as residual class 5 in `git-safety.sh`.

Note the interaction that makes this worth fixing with shape 1 rather than after it: an expansion
that is EMPTY at runtime leaves a bare redirect the guard already models, while a non-empty one
becomes an fd number. The guard cannot know which, so the safe reading is that any expansion in
the fd slot is a redirect prefix.

## Acceptance Criteria

- [x] The matcher no longer lets a redirect-shaped token satisfy the separate-arg value class of
      `-C` / `-c` / `--git-dir` / `--work-tree`, and the segment still matches as a mutating git
      command (it must become a DENY, not merely stop matching).
- [x] The tokenizer classifies a redirect **before** the `pend` checks in `git_c_target`, so a
      redirect token is never folded as a `-C`/`--git-dir`/`--work-tree` value.
- [x] **Both layers are fixed and pinned independently** — one assertion per layer. A one-layer
      fix leaves the other open, so a single passing row is not evidence the route is closed.
- [x] These DENY from a registered worktree cwd: `git -C >out $MAIN commit -m x`,
      `git --work-tree >out $MAIN reset --hard`, `git --git-dir >out $MAIN/.git commit -m x`.
- [x] Two-sided controls in the same run: `git -C $MAIN commit -m x` still DENYs, and a legitimate
      `git -C <path-inside-the-worktree> commit` still ALLOWs — no new over-deny.

      **"NO NEW OVER-DENY" IS NOT LITERALLY TRUE — there are exactly three, and they are a
      deliberate choice rather than an oversight.** `{9}` in the value slot is an fd redirect
      in zsh but a literal word in bash (whose `{varname}>` requires a valid identifier), so
      under bash git would receive `{9}` as the `-C` value, fail to chdir and mutate nothing.
      The guard cannot know which shell will run the string, so it takes the dangerous reading.
      They are pinned in `test-git-safety.sh` as an over-denial, with the reason.

      The rest of the criterion was measured on its own axis rather than with two hand-written
      rows, because tightening `_CMD_GIT_ARGVAL`'s value class is a NARROWING on a deny gate
      and `git -C <worktree>` is the spelling CLAUDE.md prescribes — a false-DENY there gets
      the guard switched off. Re-running the whole 884-row grid with every base pointed at the
      REGISTERED WORKTREE instead of main: **0 rows newly deny**, and **16 rows stop denying**
      — every one the prescribed `git -C <worktree>` idiom with a glued redirect
      (`git -C <worktree>>o commit`), which the old value class folded into the path so that it
      matched no registered worktree. The change repairs 16 false-DENYs of the sanctioned
      spelling. Four further rows deny on both sides and are CORRECT: in
      `git -C <worktree>2>&1 commit` the operator's `2` glues to the path, so the real target
      is `…agent-aaa2`, a different and unregistered directory.

- [x] The corpus is generated by inserting each operator at **every slot** of a token list, not by
      enumerating slots by name (a named-slot list reproduces whatever the author already had in
      mind — which is how this position was missed the first time).
- [x] `git-safety.sh`'s residual list is updated — but gate this on the **whole value-slot cell**,
      not on the three `>out` spellings listed above. Measured in the PR #956 round-4 review
      (144-row corpus = 3 bases x 3 insertion slots x 8 operators x 2 shells; 9 inert, **135 real
      main mutations** as the denominator). The round-4 report quoted this total as 176, which does
      not multiply out; 144 is the figure that reconciles, since 3 bases x 8 operators x 2 shells =
      48 rows per slot and 48 - 3 inert per slot = the 45 value-slot rows below. 176 cannot be
      rescued by fixing one factor: it would need 11 base-by-slot combinations, not 9. The
      45/21/24/18/6 chain the criterion depends on is unaffected and independently verified: the value slot holds **45** ALLOW rows and only **21**
      are the plain-redirect spellings this todo enumerates. Retiring residual class 4 after
      closing those 21 would leave **24** real-mutation rows allowed with NO residual naming
      them — the exact "a residual list reads as complete" failure this todo was filed to fix.
      Only convert the KNOWN-WRONG rows to `assert_deny` for shapes actually closed.
- [x] **Shape 1b:** the brace-fd spelling of the value slot denies too, and the fix is the same
      one as shape 1 rather than a second special case.
- [ ] **Shape 2:** `_CMD_REDIR` admits a parameter expansion in the fd slot, so
      `git ${nope}>o -C $MAIN commit -m x` and `git $nope>o -C $MAIN commit -m x` both DENY from a
      registered worktree cwd. Because this is a MATCHER fix on a constant with multiple
      consumers, verify every consumer of `_CMD_REDIR`, not just `git-safety.sh`.
- [ ] **Shape 2 control:** a literal `$` in a filename target (no expansion) is unaffected, and no
      safe-idiom row in the FALSE-DENY sweep starts denying.

## Implementation Notes

- The fix must move redirect classification above the `pend` checks in `git_c_target`, **and**
  stop the matcher's value class from swallowing a redirect-shaped token. The two edits are
  independent; neither alone closes the route.
- `_CMD_GIT_GLOBALS` in `.claude/hooks/lib/cmd-detect.sh` carries the same separate-arg value
  class and is shared by other consumers — check whether the fix belongs there rather than only in
  `git-safety.sh`, and widen the detector and its consumers in ONE change.
- Related, already fixed in PR #956 and worth reading first as the worked example: the brace-fd
  class (the `rpre ~ /^[{]...[}]$/` test in `git_c_target`) was narrower than `_CMD_REDIR`, which is the same
  matcher/consumer-divergence shape.

## Scope Contract

- **Mechanisms to use:** the existing matcher regex and the existing awk tokenizer in
  `git-safety.sh` — reorder/tighten what is there. No new gate, no new classification concept.
- **Files in scope:** `.claude/hooks/git-safety.sh`, `.claude/hooks/test-git-safety.sh`, and
  `.claude/hooks/lib/cmd-detect.sh` only if the shared `_CMD_GIT_GLOBALS` value class is the right
  home for the matcher half.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

**RESOLVED 2026-09-17 — the blocking dependency landed in the SAME PR as shapes 1/1b**, which is
why the value slot could be closed properly rather than 21-rows-deep. `split_segments` no longer
fractures a redirect operator, so the `&`/`|` value-slot rows reach the matcher and are covered by
the same `_CMD_GIT_ARGVAL` + tokenizer-reorder fix. What remains blocking is the OTHER direction:
shape 2 needs `_CMD_REDIR` widened, and that must serialize after PR #980 (see the banner).

The original framing, kept because the reasoning is still the right shape even though the
named-slot arithmetic under it did not survive a generated corpus — of the 24 value-slot rows this
todo's own matcher+tokenizer fix could not reach:

- **18 carry an `&`/`|` operator** (`git -C 2>&1 <main> commit -m x`,
  `git --git-dir >&2 <main>/.git commit`, `git --work-tree >|o <main> reset --hard`) and are
  FRACTURED by `split_segments` into two segments before any matcher runs —
  `git -C 2>&1 /path commit -m x` becomes `[git -C 2>]` + `[1 /path commit -m x]`. No fix inside
  this todo can see them. **`todos/P1-2026-09-13-split-segments-fractures-redirect-operators-containing-amp-or-pipe.md`
  (residual 2) must land first.**
- **6 are `git -C ${n}>o <main> commit -m x` and siblings** — single-segment, but they need the
  `_CMD_REDIR` widening tracked here as shape 2 (residual 5).

All 24 are real main mutations under **both** bash 5.3.15 and zsh 5.9 (argv measured out-of-band),
and `main` allows every one identically, so none is a regression.

- **File contention:** `lib/cmd-detect.sh` is also touched by
  `P1-2026-09-12-merge-review-guard-extractor-miss-is-a-silent-allow` and
  `P1-2026-09-15-a-root-flag-whose-value-is-a-bare-dash-...` — serialize, do not run concurrently.

## Risks

- `.claude/hooks/**` feeds main's **required** `Outward-CLI guard corpus` check. A careless edit
  wedges every open PR in the repo. Mutation-verify against **branch merged with current main**,
  never the bare branch tip.
- Tightening the matcher's value class risks over-denying a legitimate `-C` value that contains a
  redirect character. Pin an allow-side control so the tightening is shown to be one-directional.
- These hooks run under **bash**; the interactive shell here is **zsh**, which does not word-split
  unquoted parameter expansion. Assert the interpreter in any probe's own output.

## Updates

### 2026-09-16

- Filed from the PR #956 security review. Structural claims re-verified directly against the
  files; behavioural argv/hook measurements carried over from that review and flagged as
  reproduce-before-relying-on.

### 2026-09-17 — shapes 1 and 1b CLOSED, shape 2 re-scoped and still open

- Landed with the `split_segments` todo (its blocking dependency) in one PR. Both layers fixed
  and pinned separately; see the banner at the top for the mechanism.
- **The 45/21/24/18/6 chain this todo depended on was re-derived, not restated, and it does not
  survive contact with a generated corpus.** This todo enumerated slots by NAME; its own
  acceptance criteria said not to, and doing it properly changes the numbers. Generating the
  corpus by inserting each operator at EVERY gap of a token list (884 rows = 13 operators ×
  every slot × spaced/glued × 3 arg-taking globals × bash/zsh, argv ground truth from a shim)
  measured **291 live bypasses across 49 cells before the change, 114 across 20 after**, with
  **0 DENY→ALLOW regressions** and exactly **3 deliberate over-denials**. Do not reconcile the
  old chain against these figures — they count different populations, and the old one was built
  from a named-slot list.
- **Two cells neither todo enumerated were found this way and closed:** the operator GLUED to
  the flag (`git -C>out <main> commit`) and its leading-`&` sibling (`git -C&>out …`). Both are
  real main mutations under bash and zsh. A named-slot corpus cannot contain them, which is the
  point the acceptance criterion was making.
- **One near-regression was caught by the same grid.** `git -C <main>>o commit` DENIED before
  the change only BY ACCIDENT — the whole word was folded as a `-C` value that still LOOKED
  absolute. A reorder without the prefix-role branch in the redirect arm converts that accident
  into a DENY→ALLOW. It is now pinned as a regression row, not as a closure.
- **Residual class 4 was retired and class 5 widened IN THE SAME EDIT**, because retiring 4
  alone would have left the surviving value-slot rows with no residual naming them — the exact
  failure this todo was filed about. Class numbering was kept (marked CLOSED in place) rather
  than renumbered, since `test-git-safety.sh` cites the numbers.
- Shape 2 remains. Its acceptance criteria below are UNCHECKED on purpose.
