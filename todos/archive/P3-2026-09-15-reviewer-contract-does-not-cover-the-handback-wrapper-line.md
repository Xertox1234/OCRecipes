---
title: "Reviewer contract scopes the severity-word rule to the report body, but the merge gate reads the hand-back wrapper"
status: done
priority: low
created: 2026-09-15
updated: 2026-09-20
assignee:
labels: [deferred, harness, testing]
github_issue:
---

# The severity-word rule does not reach the string the gate actually scans

## Summary

All five agent definitions tell reviewers not to use the three severity words in clean
prose, and scope that imperative to the report body. In an async dispatch the merge gate's
objection guard reads the hand-back **wrapper line** instead, which the contract never
governs — so a reviewer can follow the contract exactly and still have its record suppressed.

## Background

Found 2026-09-14 while auditing PR #969's objection guard, and measured rather than argued.

`review-stamp-writer.sh`'s guard (a) runs only when the delivered message lacks
`^REVIEWED-SHA:` — which in an async dispatch is the wrapper line, not the report. If that
wrapper contains a standalone severity word, the guard treats it as an objection and writes
no record.

Measured, each behind a fully contract-compliant clean hand-back:

| delivered wrapper                                                                                                               | outcome               |
| ------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `Review complete and handed back to the caller. No CRITICAL or WARNING findings.` — one line, two severity words as bare tokens | **no record** (arm 2) |
| the two-line wrapper of `test-review-stamp-writer.sh` case 32, whose SECOND line begins with the bracketed tags verbatim        | **no record** (arm 1) |
| `Review complete and handed back to the caller. No blocking issues.`                                                            | record, verdict clean |

Row 1 carries its literal string for the same reason. An intermediate revision generalised it
to "a one-line wrapper naming two of the three severity words as bare tokens" — TRUE as a
class (three independently-worded uppercase instantiations each measured to write no record)
but not reproducible from the table, which is exactly the standard row 2 was corrected to
meet. One boundary worth keeping if that description is ever restored: arm 2 is
case-SENSITIVE, so a lowercase `no critical or warning findings` wrapper STAMPS. The severity
words the contract means are the uppercase tags.

Row 2 is quoted from the suite's own case-32 fixture rather than paraphrased. An earlier
revision of this table wrote it as `Review complete and handed back. See the hand-back for the
tag format.` — a paraphrase of residual 6's narrative description, which had dropped every
bracket and every severity word. **That string stamps.** Constructed and run against the hook
with a compliant single-handback transcript: `SEV` is empty, neither arm fires, and a clean
record is written. Putting an unmeasured string into a table headed "Measured" is the same
defect this todo exists to record, so the row now carries the fixture the description was
actually derived from.

The scoping is the issue, and it is consistent across all five files:
`server-reviewer.md:16`, `mobile-reviewer.md:14`, `ai-reviewer.md:14`,
`security-auditor.md:13` all say "In that prose"; `code-reviewer.md:37` says "In that
patterns/notes prose". Every one back-references the patterns/notes list in the report
**body**. Nothing addresses the wrapper.

This is fail-closed — the cost is a denied merge and a re-dispatch, not a bad record. But the
gate's denial message says only "no review record exists for head X" and never mentions
wrapper wording, so a re-dispatch reproduces it. A reviewer who has not read the agent
definition has no way to escape the loop from the message alone.

## Acceptance Criteria

- [x] ~~`docs/AI_WORKFLOW.md`'s dispatch prompt~~ — **absorbed into P2-2026-09-20** (see below).
- [x] The five agent definitions state that the severity-word rule covers the ENTIRE reply,
      including any hand-back wrapper line.
- [x] The wording does not itself trip the detector — `code-reviewer.md` already solves this
      by deliberately not spelling the three words in that paragraph ("quoting it back must
      not be able to trip the gate"). Match that treatment.
- [x] Re-measure the three rows above afterwards. Rows 1 and 2 are shapes a contract-following
      reviewer should no longer write; row 3 must still stamp. NOTE the asymmetry: neither row 1
      nor row 2 changes BEHAVIOUR under this fix — the guard is untouched, so both still suppress
      the stamp. What the fix changes is whether a compliant reviewer ever EMITS them. So the
      test is "does the contract now forbid these wrappers", not "do these wrappers now stamp".
- [x] Consider whether `merge-review-guard.sh`'s denial text should name this cause. It
      currently lists reasons a record may be missing; "the reply's wrapper named a severity
      word" is a real one and is invisible from the message.

## Implementation Notes

- The relevant hook comment is residual 6 in `.claude/hooks/review-stamp-writer.sh`, which
  records this gap and explicitly defers the contract edit as out of scope for PR #969
  (that PR touches two files; this touches six).
- Do NOT narrow the guard instead. Residual 6 explains why: narrowing the objection scan to
  the first non-empty line closes this class but reopens the manufactured-consent hole for
  an objection that follows a preamble, and those two directions are not equally costly.

## Scope Contract

- **Mechanisms to use:** wording changes to existing contract documents only.
- **Files in scope:** `.claude/agents/code-reviewer.md`, `.claude/agents/server-reviewer.md`,
  `.claude/agents/mobile-reviewer.md`, `.claude/agents/ai-reviewer.md`,
  `.claude/agents/security-auditor.md`, `docs/AI_WORKFLOW.md`, and optionally the denial
  string in `.claude/hooks/merge-review-guard.sh`.
- No change to `review-stamp-writer.sh`'s guard logic.

## Risks

- Editing five near-identical paragraphs invites drift between them; they are already
  near-copies, so diff them against each other after the edit.
- A careless rewording could itself contain the severity words and make every reviewer that
  quotes the contract trip the gate.

## Observed rate, 2026-09-15

The three-row table above was built by construction. A session dispatching real reviews then
produced a population measurement, which is a much stronger argument for fixing this than the
constructed rows were:

**Four async reviewer hand-backs, at four different PR heads, in one session. One produced a
stamp. Three produced none.**

| PR head    | stamp                                    |
| ---------- | ---------------------------------------- |
| `a10355fe` | written, `verdict=findings unresolved=1` |
| `d8f694f0` | none                                     |
| `0a06facb` | none                                     |
| `7aa83701` | none                                     |

All four reports carried a well-formed `REVIEWED-SHA:` block and bracketed severity tags in the
body, so the body is not what separates them — the one that stamped had findings too. What is
NOT established is the per-case cause: the wrapper text was not captured at the time, so this is
a population observation consistent with the mechanism described above, not a proof of it for
each of the three. Anyone picking this up should capture the delivered wrapper alongside the
stamp outcome before concluding.

Two things follow either way, and the first has to be scoped carefully. **What the 3-of-4 rate
measures is no-stamp outcomes FOR ANY REASON, not this mechanism's share of them.** The hook
documents at least one other real cause of a missing record for a review that ran perfectly:
residual 3 — a reviewer whose findings are all WARNING or SUGGESTION writes no stamp either, and
`merge-review-guard.sh`'s own denial message names that as a cause it warns readers about. Since
none of the three no-stamp cases had its delivered wrapper captured, the rate cannot be
attributed to the wrapper. What it does support is that missing records are common enough to be
worth an explicit fix — which is a weaker claim than "this mechanism is the common case", and is
the one to carry until the wrapper-capture follow-up above is actually done. And the recovery is
cheap once known: telling reviewers explicitly to keep the
hand-back wrapper free of the three severity words and of any bracketed tag is a one-paragraph
addition to the dispatch prompt, which is what this todo asks for.

## Updates

### 2026-09-15

- Filed from PR #969's round-5 audit, which measured the three rows above. Residual 6 in the
  hook references this work as filed; this file is that reference.

### 2026-09-15 (later)

- Added the observed-rate section after four real dispatches in one session produced one stamp
  out of four. Per-case cause not determined; see the caveat in that section.

### 2026-09-15 (third)

- Row 2 of the Background table replaced with the case-32 fixture it was derived from: the
  paraphrase in the earlier revision had no brackets and no severity words, and measurement
  shows it stamps. Acceptance criterion 3 corrected — neither row 1 nor row 2 changes behaviour
  under this fix, since the guard is untouched; what changes is whether a reviewer emits them.
- The observed-rate conclusion rescoped to no-stamp outcomes in general, which is what the count
  supports, rather than to this mechanism's share of them, which nothing here establishes.

### 2026-09-15 (fourth)

- Row 1 restored to its literal string. Generalising it put a non-reproducible entry under a
  "Measured" header — the standard row 2 had just been corrected to meet, applied
  inconsistently one row above. The class claim measured true; its case-sensitivity boundary
  is now recorded alongside.

### 2026-09-20 (scope narrowed — the dispatch-prompt half is done, and the cause is now confirmed per-case)

**The `docs/AI_WORKFLOW.md` half of criterion 1 is implemented in
`todos/P2-2026-09-20-todo-executor-commits-after-review-so-no-pr-is-stamp-clean-at-head.md`'s PR**,
by the user's explicit decision: that todo adds a confirmation review whose reliability depends on
this wording, and `docs/AI_WORKFLOW.md` was already in its scope. The dispatch prompt now scopes the
rule to the ENTIRE reply and carries a paragraph naming the hand-back wrapper specifically. It was
tested against the writer's own arm-1, arm-2 and `$CRITICALS` predicates under bash 5.3.15 — all
three NOMATCH, with a positive control that FIRES — so criterion 2 holds for that half.

**What remains here:** the five agent definitions (`code-reviewer`, `server-reviewer`,
`mobile-reviewer`, `ai-reviewer`, `security-auditor`), and the optional denial-text item 4. Nothing
in P2's PR touches any of those five files, so there is no collision.

**The Observed-rate section's open question is now answered.** That section asked a future reader to
capture the delivered wrapper alongside the stamp outcome before attributing the rate to this
mechanism. Done, 2026-09-20, from the reviewer subagent transcripts under
`~/.claude/projects/-Users-williamtower-projects-OCRecipes/bb8e9f55-*/subagents/`:

- 36 roster hand-backs in one session, **every one delivered asynchronously** — in all 36 the final
  assistant text is a wrapper, never the report — so guard (a) governed every stamp decision.
- 12 wrappers trip the guard. Excluding the single SHA `902b6ecc` (reviewed repeatedly by the same
  two agent types, where a non-tripping sibling run wrote the record), **8 of 8 tripping wrappers
  produced no record from that reviewer**; the 5 non-tripping misses all carry `clean=0` and are
  residual 3 instead.
- Of 16 clean (`No findings.`) hand-backs, **15 wrote a record and 1 did not**: PR #999's round 2 at
  `51c0df0a`, a fully contract-compliant confirmation review whose wrapper read "Both prior findings
  (… on the Scope Contract, … on the mutation-discrimination gap) are resolved". Running the
  writer's literal arm-2 predicate over that exact wrapper FIRES; the control
  `Report delivered to caller.` does not.

So the mechanism is confirmed per-case, and its rate over clean reviews is **1 in 16**, not the
3-in-4 the earlier population count might suggest — that count measured no-stamp outcomes for any
reason, exactly as this file already warned.

### 2026-09-20 — CLOSED

All criteria met. The dispatch-prompt half shipped in PR #1005 (`a2aec06e`); this change completes
the five agent definitions and takes the optional denial-text item.

**Criterion 1.** The rule now reads "keep the three bracketed severity words out of everything
except real finding lines — the notes prose, every other part of your reply, and above all any
short WRAPPER LINE you write after handing the report back", and adds the clause the measured
failure actually needed: _not even to say that findings you reported earlier are now resolved._
That is exactly the shape #999's confirmation round wrote.

It also corrects a mechanism error the old wording carried in all five files. The old text said a
severity token anywhere in the reply "records verdict `findings`". That is true of the REPORT and
false of the WRAPPER, where guard (a) fires and the hook exits before any record is written. The
new text names both outcomes separately, because the remedies differ and "no record" is the one
that reads to a human as "you never reviewed".

**Criterion 2, measured with a positive control.** All five new paragraphs extracted (4101 chars)
and run through `review-stamp-writer.sh`'s literal arm-1, arm-2 and `$CRITICALS` predicates under
bash 5.3.15: all three NOMATCH. The control `[CRITICAL] server/routes/a.ts:12 — missing auth check`
FIRES on all three, so the test discriminates rather than returning a vacuous pass.

**The drift risk this file's own Risks section named is measured away, not merely avoided.** The
four non-`code-reviewer` blocks were byte-identical before the edit (`8db99e8be678`) and are
byte-identical after it (`dcc87d5ea87f`). `code-reviewer.md` keeps its own longer paragraph, as
it did before.

**Criterion 3, with its stated asymmetry honoured.** The guard is untouched, so no row changes
BEHAVIOUR — the test is whether the contract now forbids those wrappers. Row 1 (a wrapper naming
two of the tags as bare tokens) and row 2 (case 32's second line opening with the bracketed tags)
are both now explicitly forbidden, including row 1's "to say there were none" form. Row 3
(`No blocking issues.`) is what the contract now tells reviewers to write, so it still stamps.

**Criterion 4.** `merge-review-guard.sh`'s "no record exists" denial now names the wrapper cause
and says what to do about it on a re-dispatch. **One line changed, inside a `deny()` string — no
logic touched**: `git diff --stat` shows 1 insertion / 1 deletion, `bash -n` is clean, and
`test-merge-review-guard.sh` passes 179 / fails 0.
