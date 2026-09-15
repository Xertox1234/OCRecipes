---
title: "A redirect between `git` and its verb defeats MUTATING_GIT_SEG_RE, so the worktree contract is not enforced on that command"
status: done
priority: high
created: 2026-09-13
updated: 2026-09-13
assignee:
labels: [deferred, harness, security]
github_issue:
---

# A redirect between `git` and its verb defeats the worktree contract

## Summary

`MUTATING_GIT_SEG_RE` models the tokens that may appear between `git` and its verb as
globals — `-C <x>`, `-c <x>`, `--git-dir <x>`, `--work-tree <x>`, or a generic `-<flag>`. A
redirect token starts with a digit, `>`, `<`, `&` or `{`, so it matches none of them. The
segment fails the regex, `git-safety.sh:446` takes its `|| continue`, and the worktree
contract is never checked for that command.

```
git 2>/dev/null commit -m x     ->  the guard does not see a mutating git command
```

This is the only layer for mutating git via Bash: `guard-worktree-isolation.sh` covers file
tools only (Edit / Write / MultiEdit / NotebookEdit), and `MUTATING_GIT_SEG_RE` appears
nowhere else in `.claude/hooks/` except its own test. There is no backstop.

## Background

Carried from an inventory of open guard gaps; measured 2026-09-13 rather than inherited as a
claim. The regex was extracted from the shipped hook (not transcribed) and matched against
strings — no git command was executed.

### The bypass, with controls in both directions

| segment                                  | regex verdict |
| ---------------------------------------- | ------------- |
| `git commit -m x` _(control)_            | SEEN          |
| `git -C /tmp commit -m x` _(control)_    | SEEN          |
| `git --no-pager commit -m x` _(control)_ | SEEN          |
| `echo hello` _(control)_                 | MISSED        |
| `git status` _(control)_                 | MISSED        |
| `git 2>/dev/null commit -m x`            | **MISSED**    |
| `git >/dev/null commit -m x`             | **MISSED**    |
| `git 2>&1 commit -m x`                   | **MISSED**    |
| `git >out commit -m x`                   | **MISSED**    |
| `git 1>/dev/null commit -m x`            | **MISSED**    |
| `git 2>>log commit -m x`                 | **MISSED**    |

The controls matter: three spellings that must be SEEN are, and two that must be MISSED are,
so the probe separates the verdicts rather than reporting one of them for everything.

**Position is load-bearing, and there are TWO defeating positions, not one.** A redirect
_trailing the whole command_ (`git commit -m x 2>/dev/null`) is SEEN — that one is fine. The
regex is defeated when the redirect sits INSIDE it:

| position                            | example                       | shipped    |
| ----------------------------------- | ----------------------------- | ---------- |
| interposed, between binary and verb | `git 2>/dev/null commit -m x` | MISSED     |
| interposed, glued to the binary     | `git>out commit -m x`         | MISSED     |
| **glued to the VERB**               | `git commit>log`              | **MISSED** |
| trailing the command                | `git commit -m x 2>/dev/null` | SEEN       |

An earlier revision of this todo said "only an interposed redirect defeats it" and named only
the first two. The verb-glued position defeats the regex's TRAILING boundary
`([[:space:]]|\$)` instead of its globals group — a different mechanism, same defect class,
found in review. Both are closed by the fix below; a third position is disclosed under Risks
and is NOT closed.

### Why the existing comment does not cover it

The block above the constant argues the grammar is a "STRICT SUPERSET" of its predecessor
and that it models the globals which "only need to REACH the verb". That is true of globals
and says nothing about redirects, which are not globals. The comment is accurate and the gap
is still there — it is a case the author was not modelling, not a claim that was wrong.

## Severity note

Filed **high**. It is an active bypass of a live control — the command runs now, unguarded —
which is the criterion that put
`todos/P0-2026-09-13-repo-retarget-flag-in-root-position-defeats-both-merge-guards.md` at
critical. It sits a tier below because the blast radius is narrower: the worktree contract
prevents accidental cross-checkout mutation during isolated work, and it already has a
sanctioned one-shot escape (`SKIP_WORKTREE_CONTRACT=1`), so this is an undocumented route to
something a caller may legitimately ask for — not an unreviewed merge to `main`. Bump it if
you weigh the isolation guarantee higher.

## Acceptance Criteria

- [~] **PARTIALLY MET — do not read this as closed.** `MUTATING_GIT_SEG_RE` SEES a mutating
  git command carrying a redirect between the binary and the verb, for every redirect
  spelling `_CMD_REDIR` models — **at the regex level, all 14 operators.** At the HOOK
  level, which is what the Summary's "the contract is never checked" is about, the four
  operators containing `&`/`|` (`&>`, `>&`, `2>&`, `>|`) never reach the regex **in the three
  INTERPOSED positions** — `split_segments` flushes on those characters first. Those are real
  invocations and remain a live bypass, filed separately (see Updates). The gap is
  **positional, not per-family**: in the VERB-GLUED position `&>` was already denied before
  this change and `>&`/`>|` are newly denied by it.
- [x] It also SEES a redirect GLUED TO THE VERB (`git commit>log`) — a second defeating
      position, against the trailing boundary rather than the globals group.
- [x] A false-SEEN sweep runs in the same pass: widening a boundary class is the direction
      that invents denials, so read-only verbs, near-miss binaries (`gitk`, `git-foo`,
      `digit`, `legit`) and ordinary prose must all stay MISSED. One inherited over-denial
      found and disclosed rather than silenced: `git2>out commit` (a digit glued to the
      binary) is SEEN though bash invokes `git2` — pre-existing in `_CMD_GIT_GLOBALS` for
      every consumer on main, safe direction, pinned as KNOWN-OVERDENY.
- [x] Controls in the same run, both directions: `git status` / `git log` with the same
      interposed redirect stay MISSED (a read-only verb must not become a deny), and ordinary
      prose stays MISSED.
- [x] No SEEN → MISSED transition anywhere — the change must be strictly tightening, the same
      property the existing comment claims for its own predecessor and backs with a
      differential. **0 regressions at both the regex and the pipeline level.**
- [x] Corpus generated from a product of dimensions (operator × target × verb × position),
      not hand-listed, with every count quoted together with the corpus that produced it AND
      with the applicable denominator (see the note below about `push`). **The position axis
      MUST include a glued, zero-space spelling (`git>out …`)** — the first candidate for this
      todo passed a 630-row corpus that held spacing fixed and missed every glued row.
      Regenerated independently rather than inherited; the inherited table was wrong (above).
- [x] Mutation-verified: revert the new alternative and confirm only the redirect rows redden.
      Round 1: 153 → 143 passed, the 10 that redden being exactly the 9 new redirect DENY rows
      plus the KNOWN-OVERDENY pin, with the trailing-redirect control staying GREEN — targeted,
      not a blanket break. **Five mutations in total across the three review rounds**, each
      reddening only its own rows: the walker arm (3), the naive lib source (5), the blanket
      skip (4), replace-instead-of-union (2), and the last-character predicate (5).
- [x] `.claude/hooks/test-git-safety.sh` gains the rows; full hook suite green.
      **126 → 193 in this file at archive time**; 37/37 hook self-test files pass; the required
      `Outward-CLI guard corpus` check reproduces its pin exactly (rows=602, no drift).
      The intermediate figures are kept in the Updates below because each belongs to the round
      that measured it: 153 after round 1, 174 after round 2, 182 after round 3, 193 final. An
      earlier revision of this AC left "126 → 153" standing after two further rounds had added
      40 rows — the count is a property of the tree it was taken on, and this file is archived,
      so a reader has no later revision to correct it from.

## Implementation Notes

**Reuse the shared grammar; do not re-derive it.** `lib/cmd-detect.sh:117` already defines
`_CMD_REDIR`, which models fd prefixes, `{name}` fds, `&` on either side, and the `|`/`!`
clobber overrides. Re-deriving a redirect grammar in the consumer is this repo's
most-repeated defect — PR #940 fixed the sibling instance in `guard-outward-cli.sh` by
reusing this same constant.

**And reuse the shared GROUP, not just the shared constant.** `lib/cmd-detect.sh:151` already
defines `_CMD_GIT_GLOBALS` — the whole "what may sit between `git` and its verb" group,
including a redirect branch built correctly. Replace the hand-written group outright:

```bash
MUTATING_GIT_SEG_RE="^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]+[[:space:]]+)*git${_CMD_GIT_GLOBALS}[[:space:]]+(${MUTATING_GIT_VERBS})${_CMD_POS_SUFFIX}"
```

**Two constants, two positions.** `_CMD_GIT_GLOBALS` closes the interposed redirect;
`_CMD_POS_SUFFIX` (`lib/cmd-detect.sh:126`) closes the verb-glued one, because its closer
class admits `<` and `>` alongside whitespace and the usual separators. That is not a novel widening — the sibling
predicate already needed it, and `test-cmd-detect.sh:775` pins
`cmd_is_git_commit 'git commit>log' yes "a verb glued to a redirect is still an invocation"`
with a comment naming `_CMD_POS_SUFFIX` as the reason. Reuse it rather than hand-writing a
boundary class.

`git-safety.sh` does **not** source `lib/cmd-detect.sh` today (verified — the file has no
`source` statement at all), so the fix needs that line too.

**Measured, corpus generated from its dimensions** — 14 operators × 4 targets × 6 verbs × 4
positions (spaced / **glued** / between-globals / **verb-glued**) = **1344 rows**:

> 🛑 **THIS TABLE IS A REGEX-LEVEL MEASUREMENT AND WAS READ AS A HOOK-LEVEL ONE.** It is
> correct about `grep -qE` against the constant and wrong about what the hook does, because
> `split_segments` runs FIRST and flushes on any unquoted `&` or `|`. Re-measured through the
> real two-stage pipeline (implementation, 2026-09-13): shipped **24**, candidate **912**,
> regressions **0**. Corrected table below; see Updates for why the error was invisible.

|                           | shipped | globals only | globals + suffix |
| ------------------------- | ------- | ------------ | ---------------- |
| rows SEEN (regex alone)   | 0       | 1008         | 1200             |
| rows SEEN (real pipeline) | **24**  | —            | **912**          |
| SEEN → MISSED regressions | —       | 0            | **0**            |
| false SEENs (13 probes)   | —       | —            | **0**            |

The false-SEEN sweep matters at least as much as the coverage one, because widening a
boundary class is the direction that invents denials: `git status`, `git log --oneline`,
`git diff`, `git status>log`, `git log>x`, `git remote -v`, `gitk`, `git-foo commit`,
`digit commit`, `legit commit -m x`, `git status;echo hi`, `echo git commit` and
`npm run build` all stay MISSED.

**1200, not 1344, is the applicable population — again.** The 144 rows still missed are
exactly the six digit-prefixed operators (`2>`, `1>`, `3>`, `0<`, `2>>`, `2>&1`) in the
verb-glued position, where `git commit2>log` lexes as the word `commit2` followed by `>log`
and therefore invokes `git commit2`, which is not a verb. Missing them is correct. This is
the second time on this todo that a raw count had to be reduced to its applicable subset;
quote the denominator, not the total.

### Two corrections to an earlier revision of this section, recorded rather than overwritten

**(1) A hand-spliced `${_CMD_REDIR}` into the local group is WRONG, and misses every glued
spelling.** That version put the redirect behind the group's shared mandatory `[[:space:]]+`,
so `git>out commit -m x` — a real bash invocation, since bash splits at an operator with no
surrounding space — still failed to match. `_CMD_GIT_GLOBALS` separates its redirect branch
with `[[:space:]]*` (zero-or-more) precisely for this, and `guard-outward-cli.sh` uses the
same idiom. **Citing the precedent is not following it**: the constant was reused and the
structure around it was re-derived, which is the same defect one level down.

**(2) The corpus that "verified" the spliced version held the spacing axis FIXED.** Its three
positions were all space-separated, so the glued spelling could not appear and the result read
504/504. Re-run with a glued position included, that candidate sees 336 of 504. An axis you do
not vary is an axis where a defect is invisible.

A third note kept from that revision because it is still true: an earlier reading of "504 of
630" as "the candidate still misses 126" was wrong — those 126 all used `push`, which is not
in `MUTATING_GIT_VERBS` (`commit|mv|rm|restore|checkout|switch|pull|revert|stash|reset|rebase|merge|cherry-pick|apply|am|clean`).
They were correctly missed. Generating from a product of dimensions does not help if one axis
carries values outside the population the check governs; quote the APPLICABLE denominator.

## Scope Contract

- **Mechanisms to use:** replace the hand-written globals group with `_CMD_GIT_GLOBALS` and
  the hand-written trailing boundary with `_CMD_POS_SUFFIX`, both from `lib/cmd-detect.sh`,
  sourcing that library. No new constant, no locally re-derived redirect grammar or boundary
  class, no hand-spliced alternative, no second predicate.
- **Files in scope:** `.claude/hooks/git-safety.sh`, `.claude/hooks/test-git-safety.sh`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. Independent of the open merge-gate P0/P1s, though it is the same defect CLASS — a
  redirect interposed where a grammar expected only flags — and `guard-outward-cli.sh`'s
  already-shipped fix is the worked example.

## Risks

- **Hook edits feed a required check.** The `Outward-CLI guard corpus` job covers
  `.claude/hooks/` and is main's 9th required check. Run it against branch ⊕ main, never the
  bare tip.
- **The false-DENY direction has no per-command escape worth relying on.** `git-safety.sh`
  does honour an inline `SKIP_WORKTREE_CONTRACT=1 ` prefix, so recovery is cheaper here than
  in the merge gate — but a guard that denies ordinary read-only git still gets switched off.
  Pair every new deny row with a read-only-stays-allowed row in the same run.
- `_CMD_REDIR`'s target is mandatory and greedy. The 1344-row sweep varies the target across
  four values and shows 0 SEEN → MISSED transitions, so it does not swallow the verb on any
  spelling tested — but that is a bound from the tested set, not a proof.
- **INHERITED RESIDUAL, accepted: adopting `_CMD_POS_SUFFIX` brings its wider closer class
  with it.** That class is ``[);&|`{}<>]`` — **nine** characters: `)`, `;`, `&`, `|`,
  backtick, `{`, `}`, `<`, `>`. Adopting it flips **six of those nine**, of which only
  **four** are over-denials. Measured through the real pipeline (`split_segments`, then the
  regex), stub `git` shell function so nothing ran:

  | leg                             | closers             | n   | what happens                                                                                                                                                                            |
  | ------------------------------- | ------------------- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | consumed before the regex       | `;` `&` `\|`        | 3   | `split_segments` cuts at these, so the segment already ends and the SHIPPED boundary matches at `$` — SEEN both ways, **no flip**                                                       |
  | flips, and IS a real invocation | `<` `>`             | 2   | **the fix working, not a residual** — bash splits at the operator, so `git commit>log` really does run `git commit` (verified: the stub wrote its argv to `log`). Do NOT suppress these |
  | flips, NOT a real invocation    | `)` `` ` `` `{` `}` | 4   | the over-denial disclosed below                                                                                                                                                         |

  3 + 2 + 4 = 9, the whole class. The four over-denials, one example shape each:

  | segment           | shipped | with the suffix | what bash actually produces                     |
  | ----------------- | ------- | --------------- | ----------------------------------------------- |
  | `git commit{foo}` | MISSED  | SEEN            | `argv[1]: commit{foo}` — one word, not `commit` |
  | `git commit}`     | MISSED  | SEEN            | `argv[1]: commit}` — same                       |
  | `git commit)`     | MISSED  | SEEN            | syntax error; nothing runs                      |
  | `` git commit` `` | MISSED  | SEEN            | syntax error; nothing runs                      |

  That table ILLUSTRATES the over-denial; it does not exhaust it. Each of the four
  characters admits more shapes than the row shown — `git commit{` flips too (argv
  `commit{`) — so an implementer should match on the CHARACTER, not on these four strings.

  None of them is a real invocation of the verb: a brace span with no comma is not brace
  expansion, so the token stays one word, and the other two never parse. **The direction is
  safe** — a SEEN verdict only sends the segment to the repo-resolution check, which
  resolves to cwd and passes or denies; it can never produce a wrong ALLOW.

  **SEEN → MISSED is impossible here by construction, not merely unobserved.** The suffix
  alternation is a strict SUPERSET of the shipped `([[:space:]]|$)` — the same two
  branches plus one more — and `grep -qE` tests existence of a match, so every segment the
  shipped regex matched still matches. Do **not** cite the 1344-row sweep for this sentence:
  that corpus is 14 _redirect_ operators × 4 targets × 6 verbs × 4 positions, so it contains
  zero rows shaped like the four above and its zero is a structural absence, not evidence.
  (The superset argument covers the boundary swap only. The `_CMD_GIT_GLOBALS` half of the
  fix is a separate edit and still needs its own rows.)

  Worth restating here because the CONSUMER differs — **not** because upstream is silent; it
  is not. `lib/cmd-detect.sh:67-116` already names every one of these closers ("a subshell
  `)`", "one of the same `;` `&` `|` backtick operators", and `{`/`}` as deliberate
  defense-in-depth) and then carries a "KNOWN RESIDUAL (harmless)" analysis reaching this
  block's conclusion independently: safe for deny-shaped consumers, with the same named
  exception (`drift-detect-update.sh`'s suppressive one). The narrower note at `:119-125`
  covers only the `<`/`>` addition — reading that one alone is exactly how an earlier draft
  of this block came to claim the residual was undocumented.

  What does **not** carry over is the **anchor pairing.** Upstream, `)` and backtick are
  sanctioned closers because `_CMD_POS_PREFIX` (`lib/cmd-detect.sh:118`) carries `(` and
  backtick as command-position OPENERS, so `` `git commit` `` and `(git commit)` are real
  invocations the pair legitimately catches. `git-safety.sh`'s hand-rolled prefix
  (`^[[:space:]]*(ENV=val )*git…`) has no such opener, so for THIS consumer `)` and backtick
  can only ever close an unbalanced, syntax-error segment — over-denial with no matching
  real catch. That asymmetry, not an absence of upstream documentation, is the reason to
  write it down here. Kept anyway, because the alternative — hand-writing a narrower
  boundary class here — is exactly the re-derivation this todo exists to avoid.

  **An implementer should expect flips on six of the nine closer characters, not four:**
  read `<`/`>` as the fix working, and leave the other four alone. Narrowing the class to
  silence them would delete the deliberate 2026-09-01 `<`/`>` catch.

- **DISCLOSED RESIDUAL — the one position this fix does NOT close: a redirect BEFORE the
  `git` token.** (The two positions INSIDE the regex — interposed and verb-glued — are both
  closed above; this is the third.) `2>/dev/null git commit -m x` is a real, equally valid bash invocation and is
  MISSED by the shipped regex, by the spliced candidate, and by the `_CMD_GIT_GLOBALS`
  version alike — the segment anchor `^[[:space:]]*(ENV=val )*git…` never reaches `git` when
  a redirect precedes it, and this fix only touches the group BETWEEN `git` and the verb.
  Measured. It is the same defect class in a different position, so an implementer closing
  this todo must not report the redirect bypass as closed. `lib/cmd-detect.sh:118`'s
  `_CMD_POS_PREFIX` already carries `_CMD_REDIR` as a leading-prefix alternative, so the
  library models this shape — extending the anchor is a separate, larger change and wants
  its own todo rather than being smuggled in here.

## Updates

### 2026-09-13

- Filed at the user's explicit request. The bypass, the absence of any other covering layer,
  and the candidate fix were each measured rather than inherited from the inventory note that
  surfaced it.

- **IMPLEMENTED.** `git-safety.sh` now sources `lib/cmd-detect.sh` inside the contract branch
  and rebuilds `MUTATING_GIT_SEG_RE` from `_CMD_GIT_GLOBALS` + `_CMD_POS_SUFFIX`. Sourcing
  sits behind the registry/bypass gate because that is the regex's only use site, so a session
  with no worktree contract pays nothing (measured 3.4ms marginal, n=50). When the lib is
  unsourceable the shipped hand-written regex stays in force — **fail-to-status-quo, not
  fail-closed**: it loses the redirect positions and nothing else, and never degrades to
  `exit 0`, which on this deny gate would be a silent ALLOW.

- 🛑 **The corpus table in Implementation Notes was a REGEX measurement read as a HOOK
  measurement, and the arithmetic hid it.** The hook runs `split_segments` FIRST, and that
  splitter flushes on any unquoted `&` or `|`. Four operator families contain one, so
  `git 2>&1 commit -m x` is fractured into `git 2>` + `1 commit -m x` and neither half
  matches — a real invocation (argv shim) that the regex change cannot reach.

  **Why it was invisible is the part worth keeping.** The regex-level candidate SEEN was 1200. The number of corpus rows that are real invocations is also 1200 (1344 − the 144
  correctly-missed digit verb-glued rows) — **and they are the same set**. So the table read
  as a flawless 1200/1200 while the applicable hook-level result was 912/1200 = 76%. Two
  different quantities collided on one number, and a perfect score is the least likely thing
  to re-derive. A count is a property of the PIPELINE it was taken through, not of the
  predicate you happened to test; measure at the layer your claim is about.

  Found by running the change end-to-end against the real hook, not by re-reading the corpus.
  The regex-only corpus had already agreed with itself twice.

- **Residual filed, NOT closed here:**
  `todos/P1-2026-09-13-split-segments-fractures-redirect-operators-containing-amp-or-pipe.md`.
  Fixing it means narrowing where `split_segments` flushes, which merges adjacent commands
  into one segment and breaks the `^` anchor that makes a following `git commit` visible —
  the false-ALLOW direction, and the laundering this splitter exists to prevent. That is a
  different mechanism and wants its own change, exactly as the leading-redirect position does.

- **Review round (security-auditor + code-reviewer, PR #956) — three repairs, all landed in
  the same PR rather than deferred:**
  1. **The matcher was widened and the TOKENIZER was not, and that pair introduced a
     regression.** `git_c_target`'s phase-1 walker skips dash-tokens, but a redirect starts
     with a digit/`>`/`<`/`&`, so it fell through to the "first non-option word is the verb"
     branch and ENDED the scan — every repo-redirecting global after it went unmined. Two
     directions, measured: from a worktree cwd, `git 2>/dev/null -C <main> commit -m x`
     resolved to cwd and was ALLOWED though it really mutates main; from a main cwd,
     `git 2>/dev/null -C <worktree> commit -m x` — **the `-C` spelling CLAUDE.md prescribes** —
     was newly DENIED. Fixed with a one-line redirect-skip arm gated on `!tnt`. Mutation:
     removing it reddens exactly those 3 rows and nothing else.
  2. **"FAIL-TO-STATUS-QUO" was false for three demonstrated paths.** `if . lib` only catches
     a lib that _returns_ non-zero. A top-level unset-var reference is fatal under this file's
     `set -uo pipefail` **even inside the `if` condition** — the hook died at rc=127 having
     printed ZERO bytes, which on a deny gate is a total silent ALLOW across all three
     branches; a stray top-level `exit` does the same; and a malformed or wrong-semantics
     constant passes any `-n` test and then matches nothing. Fixed by sourcing in a SUBSHELL
     (confines the fatal) plus a two-sided self-test of the composed regex before adopting it
     over the fallback. Six stub-lib rows added, with a healthy-lib control first so they
     cannot pass vacuously.
  3. **The `&`/`|` residual was stated per-FAMILY when it is POSITIONAL** — and this repo's own
     test suite already falsified it, since `git checkout>&2 -b foo` was an `assert_deny` in
     the very same diff. Measured 4 families × 4 positions: the three interposed positions are
     open, the verb-glued one is not (`&>` was already denied on main; `>&` and `>|` are newly
     denied by this change; `2>&1` correctly stays allowed because it lexes as verb `commit2`).
     Corrected in the hook comment, in the filed follow-up todo, and pinned with four rows.

  Also caught in my own new test: a row labelled "stdout does not contaminate the decision
  JSON" asserted with a `grep` for the deny substring, which still matches when junk is
  PREPENDED — so it would have passed either way. Replaced with a first-byte check plus a
  non-vacuity control. **A pin that cannot fail is not a pin.**

- **Review rounds 2 and 3 — the matcher was right early; every later defect was in the
  TOKENIZER or in a CLAIM.** Recorded because the shape repeated:
  - **Round 2 found that widening the matcher without widening `git_c_target` introduced a
    regression** — a redirect before a repo-redirecting global ended the walker's scan, so
    `git 2>/dev/null -C <worktree> commit` (the spelling CLAUDE.md prescribes) was newly
    DENIED and the mirror `-C <main>` case was silently ALLOWED. Also that
    "FAIL-TO-STATUS-QUO" was false for three paths: under `set -uo pipefail` a lib fatal is
    fatal **even inside the `if` condition**, so the hook died printing zero bytes — a total
    silent ALLOW. Fixed with a subshell plus a self-test, and adoption changed from replace
    to **union**, since a self-test cannot detect a candidate that is merely NARROWER.
  - **Round 3 found a CRITICAL I had introduced in round 2's own repair.** The pending-target
    test read the last CHARACTER of the word rather than a complete operator RUN, so a
    redirect target whose filename ends in `!` swallowed the following `-C <main>`:
    `git >out! -C <main> reset --hard` and `clean -fdx` both ALLOWED, each with a
    one-character control (`>out`) that still denied.

  **The axis that hid it, twice.** The round-2 rows all used `/dev/null` as the redirect
  target, so the target's FINAL CHARACTER never varied — the same "an axis you do not vary is
  an axis where a defect is invisible" rule this todo already states, one axis over from where
  it had just been quoted into a code comment. Writing a rule down does not install it.

  **Three claims about the same fail-safe were wrong in succession** (UNREACHABLE → REACHABLE
  → UNREACHABLE), and the true route never involved redirects at all: an arg-taking global
  swallows the verb token. All three readings are recorded in place in the hook rather than
  overwritten, because the pattern is the lesson.

  One row also shipped with the **wrong expectation**: `git >a> -C <main> commit` was asserted
  DENY from the shape of the string, when bash creates a file named `-C`, consumes it as the
  second redirect's target, and never acts on main — ALLOW was correct. Ask whether the verdict
  is CORRECT, not whether it matches the guess.

- **Scoreboard, stated so it cannot be read as more than it is:** two positions closed at the
  regex level; 10 of 14 operator families closed end-to-end; 912/1344 rows SEEN through the
  real pipeline, up from 24, with 0 regressions. **Two residual classes remain open** — a
  redirect BEFORE the `git` token, and the four `&`/`|`-containing operator families. The
  redirect bypass is narrowed, not eliminated.
