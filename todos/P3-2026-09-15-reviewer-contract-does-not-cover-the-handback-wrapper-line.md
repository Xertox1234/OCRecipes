---
title: "Reviewer contract scopes the severity-word rule to the report body, but the merge gate reads the hand-back wrapper"
status: backlog
priority: low
created: 2026-09-15
updated: 2026-09-15
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

- [ ] The five agent definitions and `docs/AI_WORKFLOW.md`'s dispatch prompt state that the
      severity-word rule covers the ENTIRE reply, including any hand-back wrapper line.
- [ ] The wording does not itself trip the detector — `code-reviewer.md` already solves this
      by deliberately not spelling the three words in that paragraph ("quoting it back must
      not be able to trip the gate"). Match that treatment.
- [ ] Re-measure the three rows above afterwards. Rows 1 and 2 are shapes a contract-following
      reviewer should no longer write; row 3 must still stamp. NOTE the asymmetry: neither row 1
      nor row 2 changes BEHAVIOUR under this fix — the guard is untouched, so both still suppress
      the stamp. What the fix changes is whether a compliant reviewer ever EMITS them. So the
      test is "does the contract now forbid these wrappers", not "do these wrappers now stamp".
- [ ] Consider whether `merge-review-guard.sh`'s denial text should name this cause. It
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
