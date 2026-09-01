<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "cmd_git_branch_create_segment's terminator class omits <, >, # — an ordinary redirect leaks into the extracted start-point"
status: done
priority: high
created: 2026-08-29
updated: 2026-09-01
assignee:
labels: [deferred, security, harness]
github_issue:

---

# cmd_git_branch_create_segment's terminator class omits `<`, `>`, `#` — an ordinary redirect leaks into the extracted start-point

## Summary

`.claude/hooks/lib/cmd-detect.sh`'s `cmd_git_branch_create_segment` (used both by
`cmd_is_git_branch_create` and by `branch-preflight.sh`'s own start-point extraction)
extracts the `checkout`/`switch` invocation up to a terminator character class that does
NOT exclude `<`, `>`, or `#`. An entirely ordinary, non-adversarial command —
`git checkout -b foo 2>/dev/null` — leaks the redirection into the extracted segment,
manufacturing a spurious start-point token. This can cause `branch-preflight.sh`'s
stale-base check to silently skip its stale-upstream fetch/deny.

## Background

Found during PR #874's `_CMD_POS_PREFIX`/`_CMD_POS_SUFFIX` boundary-widening review round
(2026-08-17 — 2026-08-29), confirmed pre-existing (present before that PR's changes,
reproduced against the commit prior to the fix) and explicitly out of that PR's Scope
Contract (which covered only brace/backtick/bang widening, not this terminator class).
Surfaced to the user for a scope decision per the Deferred Item Todos policy (High
severity — never auto-file); approved for filing 2026-08-29.

The gap is documented in the function's own header comment
(`.claude/hooks/lib/cmd-detect.sh:382-389`, "KNOWN PRE-EXISTING GAP") and in
`docs/solutions/logic-errors/cmd-position-anchor-missed-brace-backtick-bang-boundaries-2026-08-28.md`'s
Unresolved section.

**Why a shallow character-class fix is not safe**: simply adding `<`/`>` to the terminator
class still leaves the fd-prefix digit (the `2` in `2>`) as a spurious non-flag token
reaching the consuming loop in `branch-preflight.sh`, and digits cannot be blanket-excluded
from the terminator — `release/2.0` is a real, legitimate branch name that must not be
truncated. Correct handling needs `[0-9]*[<>]` recognized and stripped as a single unit
(an fd-redirect token), which is a new mechanism, not a character-class widening — the same
class of "must not simply mirror `_CMD_POS_SUFFIX`" lesson `cmd_git_branch_create_segment`'s
existing header comment already documents for the backtick/`{`/`}` distinction.

## Acceptance Criteria

- [x] `cmd_git_branch_create_segment`'s terminator recognizes an fd-redirect token
      (`[0-9]*[<>]`, e.g. `2>`, `>`, `1>>`, `<`) as a single boundary unit and excludes it
      (and everything after it) from the extracted segment — verified against
      `git checkout -b foo 2>/dev/null`, `git checkout -b foo >log.txt`,
      `git checkout -b foo 2>&1`.
      **Mechanism deviation:** implemented by DELETING the redirect (operator, fd digits and
      target word) rather than by adding characters to the terminator class. An earlier
      attempt rewrote it to `;`; that caused a deny→allow regression — see the second
      2026-09-01 Updates entry.
- [x] A real branch name containing a digit followed by a non-redirect character is NOT
      truncated — verify `git checkout -b release/2.0 origin/main` still extracts the full
      segment including `origin/main` (two-sided: this is the exact regression class the
      brace/backtick fix already hit once for `{`/`}`, per this function's own header
      comment). Also pinned: `foo2 origin/main`, and `foo 1234567` (an abbreviated-SHA
      start point, which a positional digit-strip would have eaten).
- [x] ~~`#` added to the terminator class (comment-start)~~ — **AC CORRECTED, see Updates.**
      `#` must NOT be in the terminator class: `git check-ref-format --branch issue#42`
      exits 0 and bash keeps a mid-word `#` literal, so a bare class entry would truncate a
      real branch name — the exact `{`/`}` regression again. Implemented as a
      **word-start-only** boundary (`(^|[[:space:]])#`). Behaviour verified:
      `git checkout -b foo origin/main # start from prod` clips the comment, and
      `git checkout -b issue#42 origin/main` keeps its start point.
- [x] `test-cmd-detect.sh` gains two-sided regression pins (RED before, GREEN after) for
      all three repro cases above, following this file's existing pattern for the
      brace/backtick/bang fixes. Pins added across the three rounds: clip, preserve, detection-superset, and a generated
      combinatorial corpus. Deliberately NOT itemised here — this line's count went stale three
      times in one session as each review round added pins, which is its own small lesson: a
      hand-maintained tally in prose is a claim with a shelf life. The checkable figures are the
      suite totals below, which a single command reproduces.
- [x] `test-branch-preflight.sh` gains an end-to-end reproduction: confirm the redirect
      leak previously caused (or would have caused) `HAS_START_POINT` to spuriously flip,
      and that the fix restores correct behavior. 5 pins added, driving the real hook.
- [x] Full `scripts/run-hook-tests.sh` suite still passes — 931 assertions across 34 test
      files, 0 failures (`bash scripts/run-hook-tests.sh`); test-cmd-detect 174, test-branch-preflight 37.

## Implementation Notes

Read `.claude/hooks/lib/cmd-detect.sh:341-389` in full first — `cmd_git_branch_create_segment`'s
own header comment already documents the general "terminator class must be derived
independently, not mirrored from a sibling anchor" lesson this exact fix needs to follow
again. Read `docs/rules/harness.md`'s Bash section (bash 3.2 only, no associative arrays;
`$(...)` errexit suspension; early-exiting readers fail open under pipefail) before
touching the extraction loop.

## Scope Contract

- **Mechanisms to use:** widen `cmd_git_branch_create_segment`'s terminator handling only
  — add fd-redirect-token recognition (`[0-9]*[<>]`) and `#` to the terminator class. No
  changes to `_CMD_POS_PREFIX`/`_CMD_POS_SUFFIX` or any other anchor in this file.
- **Files in scope:** `.claude/hooks/lib/cmd-detect.sh`, `.claude/hooks/test-cmd-detect.sh`,
  `.claude/hooks/test-branch-preflight.sh`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None — self-contained fix to one extraction function.

## Risks

- Same risk shape as the brace/backtick history this function's own header comment
  documents: an over-eager terminator widening can silently TRUNCATE a real, legitimate
  branch/ref name rather than correctly bounding a redirect. Every character added to the
  terminator class needs both a positive repro (redirect correctly excluded) AND a negative
  control (a real ref name containing that character or a lookalike is NOT truncated)
  before landing.

## Updates

### 2026-08-29

Filed after user approval, surfaced during PR #874's review-repair cycle (2026-08-29). See
`docs/solutions/logic-errors/cmd-position-anchor-missed-brace-backtick-bang-boundaries-2026-08-28.md`
Unresolved section for the original finding writeup.

### 2026-09-01 — FIXED

Reproduced first, then fixed. All three forms confirmed live against the real hook before
any edit, with negative controls proving the probe was not simply reporting everything
broken.

**One AC was wrong and is corrected above.** AC3 said to add `#` to the terminator class.
`git check-ref-format --branch` accepts `foo#bar`, `foo<bar` AND `foo>bar`, so none of the
three can be excluded on legality grounds — the discriminator is what bash does with them
unquoted, and it is not the same for all three:

| char    | unquoted behaviour                           | may terminate?          |
| ------- | -------------------------------------------- | ----------------------- |
| `<` `>` | ALWAYS redirection; never reaches argv       | yes, unconditionally    |
| `#`     | comment only at WORD START; literal mid-word | only after whitespace/^ |
| digits  | fd prefix only when ATTACHED to the operator | never positionally      |

`issue#42` is a legal branch name and `echo issue#42` prints it verbatim, so the flat AC
would have truncated a real start point — a third repeat of the `{`/`}` regression this
function's header already documents twice. The digit point is the same trap from the other
side: `git checkout -b foo 1234567` names an abbreviated SHA, so stripping a trailing digit
run would corrupt a real command.

**Mechanism chosen instead of widening the class:** rewrite both forms to `;`, a terminator
the class already carries. `[0-9]*[<>]+&?` consumes the fd digits and the operator as one
unit (covering `2>`, `>>`, `<<<`, `2>&1`), and `(^|[[:space:]])#.*$` clips only a word-start
comment. ~~The extraction regex itself is unchanged, so the brace/backtick reasoning above it
keeps holding.~~

> **This paragraph was WRONG and is superseded by the 2026-09-01 review entry below.**
> The struck sentence is the load-bearing error: rewriting a redirect to `;` injects a
> terminator at a _computed offset_, which IS a positional widening of the terminator class
> and inherits every hazard the brace/backtick lesson describes. It produced two deny→allow
> regressions. The shipped mechanism DELETES the redirect instead. Kept visible rather than
> silently rewritten, because "the regex is unchanged so the reasoning still holds" is a
> plausible-sounding claim worth recognising again.

**Consequence verified end-to-end, not just at the unit.** The start-point loop lives inline
in `branch-preflight.sh`, so an extractor unit test cannot show the effect. The five new
`test-branch-preflight.sh` pins drive the real hook against a genuinely stale base: before
the fix the three redirect/comment cases were SILENT (check skipped), after it they DENY.
Reverting the pipeline turns exactly those 3 plus the 6 unit clip pins red, while all
preserve-direction pins stay green — they guard the fix against over-reaching, not the
original bug.

**Method note worth carrying forward.** The first verification harness reported every case
as correct, including cases that should have failed. Cause: the Bash tool here executes
**zsh**, which does not word-split unquoted expansions, while the hooks run under **bash** —
so `set -- $SEGMENT` produced one argument instead of four and every path returned 0. Only
the negative controls exposed it. Any future probe of hook internals written directly in the
Bash tool needs an explicit shell self-test; the committed harness has one.

### 2026-09-01 (later) — review round found TWO deny-allow regressions in the first fix; both repaired

A `/codify` review round (code-reviewer + security-auditor) over the committed fix found
that it made this gate **net weaker**. Both findings reproduced independently with a
differential harness (main's extractor vs the branch's, one corpus, asserting no
DETECTED to NOT-DETECTED transition): **9 regressions**, 0 improvements.

> **Superseded — see the round-2 entry below.** That 9 is the count over MY corpus, and the
> corpus was the thing at fault: a 2189-input combinatorial one found **240**. A differential's number
> is a property of the inputs, not of the change. Quoting it as though it characterised the
> change is the same overclaim this file keeps recording.

**Regression 1 — a redirect BEFORE the create flag hid a real create entirely.** Bash
permits a redirection anywhere in a simple command, so `git checkout 2>/dev/null -b foo`
is a genuine create (`printf '[%s]' checkout 2>/dev/null -b foo` gives
`[checkout][-b][foo]`). Rewriting the redirect to `;` produced
`checkout ;/dev/null -b foo`; extraction stopped at the injected `;` before `-b`, found no
create flag, and `cmd_is_git_branch_create` returned "not a create". Check 2 never ran at
all — strictly worse than the leak this todo set out to fix. **Repair:** delete the
redirect, its fd digits and its target word instead of terminating on it.

**Regression 2 — a QUOTED word-start `#` ate the rest of the command.**
`cmd_words` deletes quote characters, and its `neutral()` set did not cover `#`, `<`, `>`.
So a quoted `#` was indistinguishable from a real comment by the time the rewrite ran, and
the greedy `#.*$` discarded everything after it — including a later real create.
`git commit -m "#123 fix the thing" && git checkout -b feature/x` went undetected. This is
ordinary usage, not adversarial. **Repair:** add `<`, `>`, `#` to `neutral()`, which is the
only place quote state still exists. That also fixed a third, milder finding (a quoted
legal ref name like `">bar"` was being clipped and losing its start point).

**Why the original verification missed both.** Every clip pin put the redirect AFTER the
create flag, and every `#` case was trailing-unquoted or mid-word. Neither failure mode was
representable in the matrix, so **833 assertions stayed green over two live bypasses** — the
count was accurate and told me nothing. The lesson is not "test more"; it is that a
same-direction suite cannot answer "did this change REMOVE a detection". Only the
differential could, and it is the artefact that should have been built first.

**Now pinned:** 13 new assertions, including 9 detection-superset pins that go red without
the repairs, plus the two preserve-direction quoted-ref pins. Verified two-sided: reverting
both repairs turns exactly those 11 red and reinstates all 9 differential regressions;
restore is byte-identical. Full suite 846 assertions across 34 files, 0 failures.

**Process note.** The false claim in the entry above is struck rather than deleted. A wrong
sentence that reads naturally ("the regex is unchanged, so the reasoning still holds") is
the tell, and this is the second time this session that a claim which "reads naturally"
turned out to be the thing that was wrong.

### 2026-09-01 (round 2) — the REPAIR had its own deny-allow regression, 240 of them

Re-reviewed the repair commits (a prior verdict does not cover later pushes). The repair
introduced a fresh, larger regression, plus three test-quality findings.

**Regression 3 — the deleting sed over-consumed past control operators.** Its target word
was written `[^[:space:]]*`, excluding only whitespace, so it also ate `;`, `&`, `|`, `)`
and backtick — exactly the characters the extractor uses as its segment boundary. A redirect
ending a clause with no space before the separator deleted the separator, fusing two clauses
into one segment; the `case` then dispatched on the merged segment's first verb and never
looked for the second:

```
git checkout main 2>/dev/null;git switch -c foo
  -> checkout main  switch -c foo     (one segment; greps for -[bB], finds none)
  -> NOT a create — though it really creates a branch
```

240 deny→allow transitions over a 2189-input combinatorial corpus (10 redirect forms × 4
unspaced separators × 6 verb-mismatched pairs), an order of magnitude worse than
the regression being repaired. **Fix:** the target-word stop-set must be the extractor's
terminator class ∪ whitespace. Note this coupling is the OPPOSITE of the lesson at the top
of the function (`_CMD_POS_SUFFIX` and the terminator "must be derived independently") —
here they are coupled by construction, and a reader over-applying the independence lesson
will desync them and revive the merge. Recorded in the header for that reason.

**Why my own differential missed it.** It ran, it was two-sided, it reported 0 regressions —
and it was wrong, because every command in my corpus kept the redirect inside a single
clause. The instrument was sound; the _inputs_ were a copy of my own blind spot. The
reviewer's corpus was combinatorial (redirect form × separator × verb pair) and found the
family immediately. **A differential's number is a property of its corpus, not of the
change** — so generate the corpus combinatorially rather than by listing the cases you
already thought of, and make the mismatched-verb pairs explicit, since a same-verb pair
still finds its create flag by accident and hides the bug.

**Now committed as a test, not as prose.** The previous round added a `code-reviewer` rule
requiring a differential and then shipped the differential as a paragraph — the commit
codified the rule and violated it. The corpus is now a generated block in
`test-cmd-detect.sh` (48 detection pins + 3 clip pins). It is deliberately NOT written as
"replay against main": after merge main == HEAD and such a test passes forever, fail-open.
It pins the invariant instead. Control: restoring the over-consuming class turns 51
assertions red (measured, not predicted — it was 39 until review round 3 found that 12 of the
48 generated pins were decorative, see the round-3 entry).

**Test-quality findings, all fixed.** (1) The two quoted-`>` detection pins did not
independently guard the `neutral()` addition — they only failed when both repairs were
reverted; the real guard is the `seg_clip` PRESERVE block, and the pins are now labelled to
say so. (2) `<` had no pin at all and could be dropped from `neutral()` with zero failures;
added, and each of `<`/`>`/`#` is now individually mutation-verified to turn a pin red.
(3) The `seg_clip` expectations couple to `cmd_words`' placeholder byte — deliberate, now
documented as such.

**And one in the docs.** The self-test snippet published in the probe convention doc used
`set -- $(printf 'a b c')` — command substitution, which zsh _does_ word-split. The real
failure mode was bare parameter expansion, which it does not. So the published "MUST be 3"
assertion returned 3 under both shells and could never fail: a self-test with no failure
mode, inside the document warning about exactly that, written in the same session as the
incident. Corrected to parameter expansion and verified to fire under zsh and pass under
bash.

Final state: differential 0 regressions, suite 34 files / 0 failures, every repair
mutation-controlled.

### 2026-09-01 (round 3) — production fix CLEARED; the coverage claims were not

Third review round, on the round-2 repairs. **No CRITICAL, and the production fix was
independently confirmed to generalise past its pinned corpus** — a reviewer tested a novel
input present in neither the repo nor any corpus (`(git checkout main 2>/dev/null)&&git
switch -c foo`) and it behaves correctly on the current lib and incorrectly on the round-2
one. After two rounds where the repair was worse than the bug, that is the first evidence
the mechanism itself is right.

Everything found was in the **coverage claims**, and one was the same defect a third time:

- **12 of the 48 generated corpus pins were decorative.** The separator `|tee x;` contains a
  space, and the round-2 buggy class stopped at the first whitespace — so the over-consumption
  never reached the `;` boundary the corpus exists to catch, and all 12 passed under both the
  correct and the buggy lib. Swapped to `|cat;` (verified discriminating). This is the third
  instance of "a change with no test that can fail", after `<` in `neutral()` and the
  self-test snippet — and this time it was _inside the corpus written to prevent it_.
- **`[&|]?` had no pin at all.** Reverting only that half left all 898 assertions green. The
  discriminating input is `git checkout -b foo >|log origin/main`: with `&?` the noclobber
  `|` is not consumed with the operator, the target class stops at it, and a real start-point
  is dropped — the exact HAS_START_POINT flip this todo exists to prevent. Pinned.
- **The bare "240" was quoted in four places with no corpus size** — in the same change that
  added clause 4 ("quote the number with its corpus"). Now stated as 240 over a 2189-input
  corpus (10 redirect forms × 4 unspaced separators × 6 verb-mismatched pairs), alongside the
  9-over-25 figure it is contrasted with.
- **The pin breakdown was self-inconsistent** (11+8+9+48 = 76, written as 75) — the third
  stale count in this file. Replaced with a description plus the suite totals, which one
  command reproduces. Counting by hand in prose is what kept failing; the fix is to stop.
- Two doc claims corrected: "the dispatch prompt carries both clauses" (there are four now,
  and it carried two), and "every command below really does create a branch" (in the `||`
  quarter it does not — the correct statement is that a pre-execution gate must flag it
  regardless, since it cannot know which side will run).

Clause 4 was also propagated to the `docs/AI_WORKFLOW.md` dispatch prompt rather than to a
second agent file, which the round-3 reviewer suggested — a second agent file would violate
the roster's single-write rule, and the dispatch prompt is the one surface reaching all five
reviewers. The boundary between the two homes is now recorded in `code-reviewer.md` itself.

Measured after all of the above: suite **899 assertions / 34 files / 0 failures**; reverting
`[&|]?` alone turns 1 pin red; reverting to the round-2 class turns 51 red (was 39).

### 2026-09-01 (round 3, security) — CLEARED against main, with two pre-existing gaps surfaced

A 3811-command corpus, generated combinatorially and ground-truthed by **executing** each
command under bash 3.2 with `git` shadowed by a recording function (so "does this create a
branch" was read off real argv, not modelled). Result:

| metric                                           | main | round-2 | HEAD    |
| ------------------------------------------------ | ---- | ------- | ------- |
| missed a real create                             | 286  | 363     | **190** |
| spurious HAS_START_POINT (skips the stale check) | 1154 | 384     | **0**   |
| `main` detected & HEAD missed                    | —    | —       | **0**   |

No regression against main on any input, and HEAD is strictly better than main on both
metrics — the spurious-start-point count, which is what this todo was filed about, goes to
zero. That is the first independent confirmation that the mechanism is right rather than
merely passing its own tests.

Fixed from this round: the `&>` / `&>>` family (operator has no fd digit and a LEADING `&`,
so the class `[0-9]*[<>]+` could not match it — `git checkout &>/dev/null -b foo`, a real
create, reported not-a-create). Now `([0-9]*|&)[<>]+`; differential shows 0 regressions and
2 improvements. The corpus gained the two dimensions whose absence let it survive green: the
`&>` forms, and **slot position** (every earlier pin put the redirect at end-of-clause-1
with the create in the _other_ clause, so the corpus structurally could not exercise the
target-word skip, which only damages tokens in the clause the redirect is in).

Also corrected: the header comment claimed the fix covers a redirect "anywhere in a simple
command". True of bash, not of the fix — it covers the subcommand rightward.

**Two pre-existing gaps surfaced, NOT fixed here** (identical on main, and both require
changing the shared `_CMD_POS_PREFIX`, which this todo's Scope Contract forbids):

1. **`git -C <path> …` blinds every `cmd_is_git_*` predicate** — `cmd_is_git_commit`,
   `cmd_is_git_commit_or_push`, `cmd_is_git_head_mover`, `cmd_is_git_branch_create` all
   return no. Blinded consumers include `branch-preflight.sh` (BOTH the detached-HEAD deny
   and the stale-base deny), `commit-verify.sh`, `drift-detect.sh`,
   `drift-detect-update.sh`. `--no-pager` and `--git-dir=` behave the same. This is the
   exact spelling `CLAUDE.md` prescribes for worktree sessions, so it is a common form.
   The fix is two-part: widening the anchor alone is a regression generator, because
   `branch-preflight.sh` resolves `BRANCH` and `@{upstream}` from the process cwd, not from
   the `-C` target. High severity; surfaced for a scope decision rather than auto-filed.
2. **A redirect BEFORE the subcommand** (`git 2>/dev/null checkout -b foo`) is missed — the
   segment extractor handles it, but stage 1's anchored grep never sees this sed. Same
   anchor, same fix.

Deliberately not pinned to their current wrong values: a test asserting today's wrong answer
goes red when someone fixes it, which is pinning the bug.
