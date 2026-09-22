---
title: "review-stamp-writer.sh takes a contract-bearing final text at face value, so a reviewer that objected in a hand-back and then re-issues a clean report as text overwrites its own objection — the one-hand-back refusal never runs on that path"
status: done
priority: high
created: 2026-09-22
updated: 2026-09-22
assignee:
labels: [harness, security]
github_issue:
---

# The stamp writer's objection check is skipped whenever the delivered text carries the contract

## Summary

`.claude/hooks/review-stamp-writer.sh` gates its whole hand-back fallback — including the
"exactly one hand-back" refusal and the wrapper-objection refusal — on the delivered text
**lacking** `^REVIEWED-SHA:` (line 105). A transcript in which the same agent first handed back an
objection and then wrote a contract-shaped clean report as plain text is therefore parsed from the
text alone, and the clean verdict **overwrites** the agent's earlier `verdict: findings` record at
that head. That is the fail-open direction the writer's own "EXACTLY ONE HANDBACK" comment says it
refuses, reached through a shape that comment does not consider.

## Background

Found during the review of PR #1010 (2026-09-22) by the gate-lens reviewer, which ran the live
writer under bash 5.3.15 with `REVIEW_STAMP_ROOT` pointed at a scratch directory, on constructed
transcripts, four rows with controls:

| Transcript shape                                                         | Record written                           |
| ------------------------------------------------------------------------ | ---------------------------------------- |
| one objection hand-back + plain wrapper (positive control)               | `verdict: findings, unresolved: 1`       |
| two hand-backs (objection, then clean) + plain wrapper                   | objection record left standing (refused) |
| one objection hand-back, then the clean contract re-issued as final text | **overwritten with `verdict: clean`**    |
| two hand-backs AND the clean contract as final text (hybrid)             | **overwritten with `verdict: clean`**    |

Every row is what the code predicts: the count check at lines 166-174 and the wrapper-objection
arm at lines 161-165 sit inside `if ... ! grep -q '^REVIEWED-SHA:' <<<"$MSG"` (line 105), so a
final text that carries the contract is parsed directly and the record is written to
`$DIR/${AGENT_TYPE}.json` (line 534), one file per agent type per head. A live resumed reviewer
delivering this shape has **not** been observed; the one live resumed reviewer measured so far
(PR #960, 2026-09-22) handed back a second time and was correctly refused. Reachability is
inferred from the hand-back tool's own description ("use it once"): a resumed reviewer following
that description would write its second report as text.

The residuals comment (item 6, around lines 465-468) states the structural gate as a **no-false-
deny** property — "a clean report that CARRIES the contract never reaches either arm" — which is
true, and is exactly why a prior objection in the same transcript is never consulted on that path.

Orchestrator-side mitigation is codified and does not close the gap:
`docs/solutions/conventions/resumed-reviewer-never-stamps-re-adjudicate-by-fresh-dispatch-2026-09-22.md`
(never resume a reviewer to re-adjudicate; resume for a question only with "answer in prose, no
REVIEWED-SHA/REVIEWED-FILES"). Its Exceptions section names this gap as "unchanged code, surfaced
rather than filed" — this todo is the filing.

## Acceptance Criteria

- [x] A transcript with at least one `SubagentHandback` whose message carries an objection (a
      standalone bracketed severity token, detected with the SAME two arms the wrapper check at
      lines 161-165 already uses), followed by a final text that carries the contract and ends
      with `No findings.`, writes **no record** — regardless of how many hand-backs there are.
- [x] The hybrid shape (two hand-backs, then contract-bearing final text) writes no record.
- [x] The positive and negative controls keep their measured behaviour in the same test run: one
      clean hand-back + plain wrapper → `verdict: clean`; one objection hand-back + plain wrapper
      → `verdict: findings`; two hand-backs + plain wrapper → no record.
- [x] A text-only delivery (zero hand-backs, contract in the final text) stamps exactly as today.
      This is the majority population (88 of 281 roster transcripts on 2026-09-14, a session
      measurement recorded in auto-memory rather than in the tree) and must not
      regress — assert it with a fixture, not by omission.
- [x] The shape "one CLEAN hand-back plus a contract-bearing final text" is decided explicitly, not
      by accident: either it keeps stamping clean (the fix keys on an objection, not on the mere
      presence of a hand-back), or the todo's Updates entry records why it must be refused and
      the measured count of that shape in the roster-transcript population.
- [x] The residuals comment block (item 6) is corrected to name the new check, and no longer
      implies that skipping the fallback on contract-bearing text is safe with respect to a
      prior objection.
- [x] All existing cases in `.claude/hooks/test-review-stamp-writer.sh` still pass via
      `scripts/run-hook-tests.sh`, plus the new fixtures above, and `EXPECTED_TOTAL` is updated.
      The suite needs a real `.git` (`git init` the sandbox — a `git archive` sandbox reads one
      assertion short).
- [x] `docs/solutions/conventions/resumed-reviewer-never-stamps-re-adjudicate-by-fresh-dispatch-2026-09-22.md`
      Exceptions bullet is updated in the same PR: the plain-text re-issue shape is now refused,
      and the orchestrator rule stands for the cost reason (a refused record costs a round) rather
      than the safety reason.

## Implementation Notes

- **Key on the transcript, not on the record path.** A fresh same-type dispatch at the same head
  legitimately replaces `${AGENT_TYPE}.json` (a false finding withdrawn by a NEW reviewer — the
  designed re-review path, used on PR #960 at `fb1ae735`). Do not "fix" the overwrite at line 534;
  the defect is that the SAME agent's earlier objection is never consulted when its final text
  carries the contract.
- Minimal shape: compute, unconditionally and before the line-105 gate, whether ANY
  `SubagentHandback` message in `$TP` carries an objection (reuse the exact arm-1 anchored
  case-insensitive regex and arm-2 case-sensitive standalone regex from lines 161-165 — do not
  write a third variant, item 4 of the residuals explains why the two arms differ). If so, exit 0
  without writing, whatever `$MSG` looks like. Leave every other branch as it is.
- Detection must run over the hand-back `.input.message` bodies, i.e. the same `jq -rs` selection
  the count at lines 166-168 already uses; extract with `// empty` (the harness rule: `jq -r` on
  an absent key prints literal `null`).
- Bash 3.2 target (stock macOS): no `mapfile`, no associative arrays; guard empty arrays under
  `set -u`. Hooks fail open and silent on infrastructure errors (`exit 0`), which here is also the
  safe direction — no record is a deny at the gate.
- Fixtures: the writer's test file already builds synthetic transcripts; add the four rows from
  the Background table verbatim as cases, named for their shape, each asserting the record's
  presence/absence AND its verdict, not just exit status.
- Population measurement for the "one clean hand-back + contract text" shape, if wanted: the
  roster-transcript corpus used on 2026-09-14 (SubagentStop transcripts of the five reviewer
  agent types under the Claude projects directory). Constructed fixtures satisfy the acceptance
  criteria on their own; the population count only informs the fifth criterion's choice.

## Scope Contract

- **Mechanisms to use:** the writer's existing transcript parse (`jq -rs` over `$TP`) and its
  existing two objection-detection arms. No new hook, no new file, no change to the record
  format, no change to `merge-review-guard.sh`.
- **Files in scope:** `.claude/hooks/review-stamp-writer.sh`,
  `.claude/hooks/test-review-stamp-writer.sh`, and the one Exceptions bullet in
  `docs/solutions/conventions/resumed-reviewer-never-stamps-re-adjudicate-by-fresh-dispatch-2026-09-22.md`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. The orchestrator-side rule (fresh dispatch, never resume) is already merged (#1010) and
  stays in force regardless.

## Risks

- The writer is on the merge path of every PR: a defect that makes it write nothing for a
  legitimate clean review wedges every open PR (fail-closed, so confusing rather than dangerous,
  but expensive). The text-only and single-clean-hand-back fixtures exist to catch exactly that.
- `.claude/hooks/**` is off the automerge allowlist and this todo carries the `security` label, so
  the PR is always reviewed by a human; the merge-review guard classifies it as risk and demands a
  clean record at its final head — which this very writer produces. Verify the record on disk
  before merging, per `docs/AI_WORKFLOW.md` → Confirmation pass.
- Edits to `.claude/hooks/*.sh` take effect on the next hook invocation, but reviewer agent
  behaviour only changes on session reload — do not claim the end-to-end shape works from the
  editing session alone; the hook test suite is the evidence.

## Updates

### 2026-09-22

- Filed at the user's request after the PR #1010 gate-lens review measured the four shapes above.
  The orchestrator-side mitigation was codified in the same PR; this todo tracks the writer-side
  fix.

### 2026-09-22 — CLOSED (guard batch E, with the trailing-comment P1)

- **Mechanism.** A third guard, (c), runs BEFORE the existing `$MSG lacks ^REVIEWED-SHA:` block
  and only on its complement: when the delivered text CARRIES the contract, every
  `SubagentHandback` body in the transcript is read (the same `jq -rs` selection guard (b)'s
  count uses, `// empty` for an absent message) and if any body carries an objection the hook
  exits without writing. The two objection arms were hoisted into one `objection_in` function
  shared by guards (a) and (c), so the sites cannot drift.
- **The Implementation Notes and acceptance criterion 3 disagreed, and the criterion won.** The
  notes said to exit "whatever `$MSG` looks like"; criterion 3 requires an objection hand-back
  behind a plain WRAPPER to keep recording `findings`. Those cannot both hold, because an
  unconditional check would swallow the wrapper path's only honest record. Guard (c) is
  therefore scoped to the contract-bearing-text path — the one where the transcript was never
  consulted — and the wrapper path still flows through (b). Case 36 asserts both stops of the
  real resumed-reviewer sequence into one stamp root: stop 1 records `findings`, stop 2 (contract
  text) leaves it standing.
- **Criterion 5 decided: the "one CLEAN hand-back plus contract-bearing text" shape keeps
  stamping clean** (case 40). The check keys on an objection, not on the presence of a hand-back;
  a reviewer that handed back clean and also wrote the report as text contradicted nothing, and
  refusing it would buy no safety for one re-dispatch per occurrence. No population count was
  taken — the constructed fixtures decide the criterion on their own, as the notes allowed.
- **A pre-existing control pinned the laundering shape and had to flip.** Case 22 ("a direct
  report still wins over a transcript handback") paired a FINDINGS hand-back with a clean
  contract text and asserted the clean stamp — exactly the shape this todo closes. It is
  re-pinned with a clean hand-back for ANOTHER head (record lands at the direct report's sha,
  nothing at the hand-back's), which keeps the precedence property it existed for; case 37 now
  holds the old fixture with the opposite verdict.
- **Measured:** `test-review-stamp-writer.sh` 66 → 73 assertions (`EXPECTED_TOTAL` moved), RED
  on exactly cases 36-stop-2, 37, 38 and 41 before the writer change with the three controls
  (36-stop-1, 39, 40) green, then 73/73 after it, under bash 5.3.15 via the suite's own
  `bash "$HOOK"` invocation. `merge-review-guard.sh` untouched by this todo.
- **Residuals left open, named in item 6:** an objection that carries no severity word at all is
  invisible to both arms, as it always was for guard (a) — in either delivery shape, once the
  confirmation round below widened (c) to prior report texts; and a prior objection TEXT that
  withheld the contract is not read as a prior report (pre-existing; folded into the P3 filed from
  round 1 as its second class, see the round-2 entry below).
- **Out of the stated Scope Contract, disclosed:** one sentence in `docs/AI_WORKFLOW.md`'s
  Confirmation-pass paragraph stated that a plain-text re-issue "stamps whatever that text says
  over its own objection record". The tree now contradicts it, so the sentence was corrected in
  the same change (the rule it supports is unchanged). No other file outside the contract moved.

### 2026-09-22 — PR #1012 review round 1 (one pass, `code-reviewer` + `security-auditor`)

- **Fixed (a defect in the new guard, not pre-existing):** guard (c) emptied the hand-back bodies
  on a jq parse failure and fell through to the text parse, stamping the text over an objection
  the hook could not read — the fail-open direction and the opposite of guard (b). Now a
  transcript jq cannot parse exits without writing, per the header's policy. Cases 42 (objection
  - malformed line + contract text → no record) and 43 (malformed, no hand-back → no record; the
    parse failure alone refuses, case 39 is the well-formed positive control). Suite 73 → 75.
- **Declined:** letting (c) fall through when the delivered text ITSELF carries an objection, so
  an objection hand-back plus a findings-bearing text keeps recording `findings` as on main. Both
  outcomes deny, but the fall-through reopens laundering: a text with a standalone severity word
  in prose and a terminal `No findings.` parses to `clean` (the writer keys on the last line, and
  WARNING-class words do not block it), so the "text objects too" test cannot distinguish a real
  objection from a clean report that names the format. The refusal stays unconditional on that
  path; the cost is one shape whose deny now reads as "no record" instead of `findings`.
- **Filed, pre-existing on main:** a later objection from the same reviewer cannot retract an
  earlier clean record at the same head —
  `todos/P3-2026-09-22-a-later-objection-cannot-retract-an-earlier-clean-record-at-the-same-head.md`.
- **Doc completeness (baseline reviewer):** the solution doc's Rule section still narrated the
  overwrite in present tense while its Exceptions bullet said closed; both now agree.

### 2026-09-22 — PR #1012 confirmation round (fresh `code-reviewer` + `security-auditor` at f0a4e622)

- **Baseline: no findings**, record on disk at the head with the gate's digest.
- **Security: one finding, a claim wider than the code.** Guard (c) read only hand-back bodies,
  so an objection delivered as a contract-bearing TEXT (the majority delivery shape), followed by
  a clean text re-issue, still overwrote `findings` with `clean` — measured identically on main
  and the branch (cases c11/c12), a PRE-EXISTING route; what was new was prose here, in the
  writer's residual item 6 and in the solution doc, saying the plain-text re-issue was closed
  with only the no-severity-word hand-back left. **Closed rather than rescoped**, because it is
  the same laundering as this todo with the first report's delivery shape swapped, and filing it
  would have meant a High-severity sibling of this very todo: guard (c) now also reads every
  prior assistant TEXT body that itself carries the contract (a prior REPORT, never working
  narration — case 47 pins that a narration line naming the format does not refuse), excluding
  the delivered text by value (case 44 stop 1 pins that a single-stop findings report still
  records `findings`). Cases 44-47, suite 75 → 80, RED on exactly the two laundering shapes
  before the change with the three controls green.
- **Also confirmed by that review:** a generated 2304-row corpus over both guards (2 positions ×
  6 preceding words × 2 glues × 3 fd prefixes × 8 operator families × 2 operand glues × 2
  operands, argv ground truth from a stub under bash 5.3.15 and zsh 5.9) found 0 DENY→ALLOW rows
  in either guard, 144 new denials all word-initial, and every remaining implicit-POST ALLOW
  either the pinned anchor-cost class or a non-executable `--method{fd}` shape that main allows
  identically. Recorded in the trailing-comment todo's own entry as well.

### 2026-09-22 — PR #1012 confirmation round 2 (fresh `code-reviewer` + `security-auditor` at 09ded935)

- **Both reviewers found the same defect in the round-1 widening, fixed here:** the
  exclusion-by-value compared `$MSG` (captured through `$(...)`, which strips every trailing
  newline) against the transcript's raw `.text` (which keeps them), with CR normalisation running
  later in the file — so a findings delivery ending in a newline, or differing from its transcript
  copy by CR alone, re-entered `PRIOR_REPORTS` as its own prior report, tripped an arm, and lost
  its `findings` record. Fail-closed only, and no real last assistant text across the 616
  subagent transcripts scanned ends in a newline (two independent scans; the first quoted a
  434-text denominator the second could not reproduce, the second counted 613 non-empty last
  texts — the zero holds in both), but a regression against main on findings deliveries and a false sentence in the
  guard's own comment. The security reviewer's 69-row generated probe (3 verdicts × 7 tail shapes
  × 2 pre-existing records, plus CR-mismatch, byte-identical, contract-free and narration rows,
  under bash 5.3.15 and 3.2.57) put the cost at 16 rows, all `curEqText=no`, and verified the
  one-line fix restores every one with no other row changing. Both sides are now normalised
  inside the jq comparison (`gsub("\r";"")`, `sub("\\s+$";"")`); cases 48-51 pin the newline,
  the seeded-clean-record, the CR-only-mismatch and the trailing-space-control shapes, suite
  80 → 85, RED on exactly the three strip-related rows before the change. Positional exclusion
  of the last transcript entry was rejected on the reviewer's argument: a transcript flushed
  before the delivery is appended would then drop a genuine prior report, the fail-open way.
- **Second finding, prose wider than the code, rescoped not fixed:** guard (c) selects prior
  texts by the contract marker (so narration is never mistaken for a report), so a prior
  objection TEXT that WITHHELD the contract — a refusal — is not read, and a later clean text
  re-issue stamps on main and here alike (rows `C-BR/RO/IND-nocontractObj-then-clean`).
  Pre-existing, 0 real instances; named as a residual at every site and folded into
  `todos/P3-2026-09-22-a-later-objection-cannot-retract-an-earlier-clean-record-at-the-same-head.md`
  as its second class, with the candidate mechanism (also select prior texts matching arm 1) and
  the narration cost it must decide.

### 2026-09-22 — PR #1012 confirmation round 3 (fresh reviewers at 6c809f81)

- **Code clean, three ways.** A baseline reviewer with the gate's verbatim 13-path list (the
  archived todo had crossed git's rename threshold after three rounds of entries, so the old path
  reappeared as a delete) returned no findings and its record is on disk with the gate's digest.
  A second baseline reviewer ran a mutation check (the new suite against the pre-fix writer: RED
  on exactly the three strip rows) and the suite under bash 3.2.57. The security reviewer built a
  1024-row grid (4 prior-text shapes × 8 tails × 4 delivery shapes × 8 tails, transcript =
  [prior, delivery]) with an independent bash oracle per row: 0 mismatches against the oracle,
  618 main→head differences all record→none in the deny direction, 0 main-none→head-record, and
  no clean delivery refused that 09ded935 did not refuse (raw equality implies normalised
  equality, so the retained set only shrank). Its structural argument for the normalisation: the
  strip deletes only CRs and one trailing whitespace run, so two texts can compare equal only if
  they agree on every other byte — a prior text excluded this way carries exactly the delivery's
  own objection content, never a different one.
- **Prose fixed (baseline-doc finding):** the solution doc's title, H1 and Why paragraph still
  described the pre-fix writer, and two bullets claimed closure for "whichever way that objection
  was delivered"; all now state the hand-back-or-contract-text scope and the contract-free
  residual.
- **Filed, unreachable-regime regression:** guard (c) passes the delivered text to jq as one argv
  string, so a delivery above the platform's argv limit (measured: 1,105,119 bytes on macOS)
  fails the call and writes no record where main stamped — 23× the largest real delivery.
  `todos/P3-2026-09-22-guard-c-passes-the-delivered-text-as-one-argv-string-so-a-1mib-delivery-writes-no-record.md`.
- **Real-data reach of guard (c)'s widening, measured by that review over 616 subagent
  transcripts:** 123 deliveries carry the contract in the last text; 117 have no prior
  contract-bearing text; 5 now refuse (4 findings texts behind an earlier objecting report —
  denied either way — and 1 clean text at a NEW head from a reviewer resumed across three heads,
  the refusal the solution doc prescribes); 1 has a prior clean report and stamps. Zero real
  transcripts contain the same-head objection-then-clean laundering shape.
