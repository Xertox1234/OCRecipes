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
      **Mechanism deviation:** implemented by rewriting the redirect to `;` (a terminator
      the class already has) rather than by adding characters to the class — see Updates.
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
      brace/backtick/bang fixes. 11 pins added (6 clip, 5 preserve).
- [x] `test-branch-preflight.sh` gains an end-to-end reproduction: confirm the redirect
      leak previously caused (or would have caused) `HAS_START_POINT` to spuriously flip,
      and that the fix restores correct behavior. 5 pins added, driving the real hook.
- [x] Full `scripts/run-hook-tests.sh` suite still passes — 833 assertions across 34 test
      files, 0 failures.

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
comment. The extraction regex itself is unchanged, so the brace/backtick reasoning above it
keeps holding.

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
