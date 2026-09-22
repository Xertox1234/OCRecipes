---
title: "review-stamp-writer.sh: a later objection from the same reviewer cannot retract its earlier clean record at the same head — only a contract-bearing objection text overwrites it"
status: backlog
priority: low
created: 2026-09-22
updated: 2026-09-22
assignee:
labels: [deferred, harness, security]
github_issue:
---

# A stop-2 objection leaves a stop-1 clean record standing

## Summary

The record writer keys one file per agent type per head. When a reviewer hands back a clean
report (stop 1, `verdict: clean` written) and is then resumed and objects (stop 2), the objection
does not retract the clean record unless it arrives as a contract-bearing text: a plain-text
objection without the contract exits at guard (a) writing nothing, and a second hand-back exits at
guard (b) writing nothing — so `clean` stands either way. Measured identically on `origin/main`
(`8ff7cfd2`) and on the guard batch E branch during PR #1012's security review (case c7), so this
is PRE-EXISTING and outside that PR's scope; it was surfaced there and filed here.

## Background

Guard (b)'s "fail closed" describes writing nothing, which is only fail-closed when no earlier
same-type record exists at that head. The realistic sequence is the inverse of the one batch E
closed (objection first, clean re-issue second): a reviewer certifies, the orchestrator resumes it
with a question, and the answer contains a real objection. The gate would still see `clean`.

The orchestrator-side rule already narrows this: never resume a reviewer to re-adjudicate, and a
resume for a question must ask for prose without `REVIEWED-SHA`/`REVIEWED-FILES`
(`docs/solutions/conventions/resumed-reviewer-never-stamps-re-adjudicate-by-fresh-dispatch-2026-09-22.md`).
A push invalidates every stamp on the old head anyway. So the exposure is a same-head window
between a clean stamp and a merge, in which the same reviewer changes its mind.

## Second class, added from PR #1012's confirmation round 2 (2026-09-22)

A prior objection delivered as TEXT that **withheld the contract** — a refusal rather than a
report, e.g. a bracketed or roster-rendered finding with no `REVIEWED-SHA:` line — is not read by
guard (c), which selects prior texts by the contract marker so that working narration is never
mistaken for a report. Stop 1 writes nothing (guard (a) exits), and a stop-2 clean contract text
then stamps `clean` on both main and the batch E branch (rows `C-BR-nocontractObj-then-clean`,
`C-RO-nocontractObj-then-clean`, `C-IND-nocontractObj-then-clean` in the round-2 security probe).
Same-agent, same-head, pre-existing. Two independent scans of the 616 subagent transcripts under
the project's Claude directory found no real instance of this laundering shape (the second scan
found one contract-free last text with a column-0 bracketed line — a scoped re-review quoting
writer fixture rows, no contract requested — and 58 contract-free last texts carrying a standalone
severity word, all wrappers or narration, residual 6's class; none followed by a clean re-issue at
the same head). Candidate
mechanism: additionally select prior texts that match arm 1 (a line-start bracketed tag), which
the narration control (case 47) does not match — but decide the narration false-refusal cost
explicitly, since a narration line that starts with a bracketed tag would then refuse.

## Acceptance Criteria

- [ ] A same-type record at the same head with `verdict: clean` is REPLACED (or deleted) when the
      writer later sees, for that agent type, a hand-back or delivered text carrying an objection
      through the existing two arms — even when the writer would otherwise write nothing.
- [ ] Controls in the same run: a clean stop 1 followed by a clean stop 2 still reads `clean`; a
      fresh same-type dispatch that legitimately withdraws a false finding (the designed
      re-review path) still replaces `findings` with `clean`.
- [ ] The decision on WHICH signal may retract is recorded: an objection reaching guard (a) or
      (b) is the candidate; whether a wrapper-only severity word (residual 6's false-deny class)
      may retract must be decided explicitly, not by accident.
- [ ] `test-review-stamp-writer.sh` fixtures for every row above, `EXPECTED_TOTAL` updated.

## Implementation Notes

- The natural site is the two `exit 0` paths in guards (a) and (b): before exiting, if a record
  for `$AGENT_TYPE` already exists at `review_stamp_dir <sha>` and the delivered text or the
  hand-back bodies carry an objection (`objection_in`), remove or overwrite that record.
- Be careful about the direction: deleting a record is fail-CLOSED at the gate, so an
  over-eager retraction only costs a re-dispatch; a missed retraction is the fail-open case.
- Bash 3.2 target; the writer fails open and silent on infrastructure errors.

## Scope Contract

- **Mechanisms to use:** the writer's existing guards (a)/(b), `objection_in`, and
  `review_stamp_dir`. No new hook, no change to the record format, no change to
  `merge-review-guard.sh`.
- **Files in scope:** `.claude/hooks/review-stamp-writer.sh`,
  `.claude/hooks/test-review-stamp-writer.sh`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. Batch E (PR #1012) lands guard (c) and `objection_in`, which this builds on.

## Risks

- The writer is on the merge path of every PR; a retraction that fires on a legitimate clean
  sequence wedges merges (fail-closed, so confusing rather than dangerous, but expensive).
- `.claude/hooks/**` is off the automerge allowlist and this carries the `security` label, so
  the PR is always human-reviewed.

## Updates

### 2026-09-22

- Filed from the security review of PR #1012 (guard batch E) as a pre-existing gap, per the
  binding 2026-09-17 one-pass decision (findings that are not regressions are filed, not fixed).
