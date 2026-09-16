---
title: "A newline inside a filename forges an extra destination row in todo-automerge-guard — it inflates the completeness count AND satisfies the TODO GATE with an archive file that is not in the diff"
status: backlog
priority: medium
created: 2026-09-16
updated: 2026-09-16
assignee:
labels: [deferred, harness, security]
github_issue:
---

# A newline in a filename can forge a destination row

## Summary

`todo-automerge-guard.sh` classes each changed-file row on the way out of jq (`F ` destination,
`P ` rename source, `X` unusable rename source) and compares the count of distinct `^F ` rows
against the PR's declared `changedFiles` to detect a truncated file list. Because the classes live
in **flattened text**, a filename containing a literal newline emits a second line that looks like
a destination row, inflating the count and masking a file the endpoint truncated away.

## Measured

Found in the PR #978 security review, measured against the pristine guard with a fake `gh` shim
(text in, verdict out — nothing executed):

- Rows `[todos/archive/P3-2026-07-08-example.md, "client/a.ts\nF client/b.ts"]` with declared
  count **3** returns **rc=0** — `guard: OK ... every changed file is on the safe allowlist`.
- The identical case without the padded tail — two plain rows, declared **3** — correctly returns
  **rc=2**: `read 2 changed paths but the PR declares 3 changed files, so the list is truncated`.

The pair differs only by the injected line, so the pass is attributable to the forged row and not
to the counts.

Note the direction split, which is what keeps this at medium: the injected path is still **gated
normally** by the PATH GATE, so this is not a route to sneaking a protected path past path
classification.

But `files` has a **second consumer**, and the damage is NOT confined to the completeness count.
The TODO GATE discovers the archived todo by grepping `files` for `^todos/archive/.+\.md$`. A
forged `F todos/archive/<path>` line therefore satisfies the "no `todos/archive/*.md` in the diff"
HOLD using any archive file that merely exists in the PR's **head tree** — the frontmatter read is
`contents/<path>?ref=refs/pull/N/head`, which resolves from the head tree, not from the diff.
Measured three-way with a head-tree-aware shim: one plain changed file, no archive in the diff,
declared 1 → **rc=1** "no todos/archive/\*.md in the diff"; the same run with a forged archive tail
and that path present in the head tree → **rc=0** `guard: OK`; attribution control, identical
forgery with the archive path absent from the head tree → **rc=1** via the 404 arm.

Containment: the PATH GATE still gates every segment, and `merge-review-guard.sh` records that
stage 1's ALLOW set is a strict subset of stage 2's, so this cannot widen the merge gate's ALLOW
set. The consequence is confined to auto-merge arming by the executor.

## Background

Preconditions differ per consequence, and conflating them is how this gets deprioritised wrongly:

- **Completeness inflation** needs BOTH a tracked filename carrying a literal newline AND
  simultaneous server-side truncation of the `pulls/{n}/files` endpoint.
- **The TODO-GATE flip needs the newline ALONE.** The probe that flipped rc 1 → 0 ran with
  declared 1 and seen 2, so the truncation arm was not merely quiet — the count was ABOVE the
  declared total and the arm correctly did not fire.

Neither is reachable without a committed filename containing a literal newline, which is why this
stays medium rather than high. It matters because of the consumer:
`merge-review-guard.sh` treats this guard's exit 0 as "no review record required", so a masked
truncation is a merge-gate bypass rather than merely a missed auto-merge hold.

## Acceptance Criteria

- [ ] The completeness count no longer derives from flattened text. Preferred fix, which needs no
      extra API call: have the SAME jq pass emit one count row ahead of the file rows
      (`"N \(length)"`) and require the distinct-`F` count to equal it. The count then comes from
      the JSON array rather than from the text, so a newline-injected `F ` row breaks the equality
      and trips the existing fail-closed arm.
- [ ] A regression row pinning the forged-row case: injected tail with declared count high, assert
      exit 2 and assert the **diagnostic**, not just the code — three separate arms in this script
      exit 2, so a bare status check cannot attribute the failure.
- [ ] A must-still-pass control in the same run: ordinary rows with an agreeing declared count are
      gated normally, so the ERROR is attributable to the forged row.
- [ ] **The TODO GATE's read of `files` is covered too.** The preferred fix above (a jq-emitted
      count row compared against the distinct-`F` count) closes the completeness inflation and does
      NOTHING about the forged-archive flip, so this todo worked as originally written would have
      been closed with the measured rc 1 → 0 still live. Pin that flip with a row of its own.
- [ ] Mutation-verified: with the fix reverted, the new rows go RED. An arm that cannot fail pins
      nothing.

## Implementation Notes

- The emitted format is consumed by THREE harnesses: the guard itself, the vitest stub in
  `scripts/__tests__/todo-automerge-guard.test.ts`, and the bash stub in
  `.claude/hooks/test-merge-review-guard.sh`. A previous format change broke seven rows in the
  second stub because `merge-review-guard.sh` consumes this guard and its fixture stubbed the old
  shape. Widen the producer and ALL its consumers in one change, and run the full hook suite
  (`bash scripts/run-hook-tests.sh`), not just the guard's own test file.
- `.claude/hooks/test-merge-review-guard.sh`'s `pr diff` branch is deliberately left unclassed —
  that guard consumes it directly for its own digest. Do not class it.

## Scope Contract

- **Mechanisms to use:** the existing jq emission and the existing completeness comparison. No new
  API call, no new gate, no new file.
- **Files in scope:** `scripts/todo-automerge-guard.sh`,
  `scripts/__tests__/todo-automerge-guard.test.ts`, `.claude/hooks/test-merge-review-guard.sh`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- Sequenced after PR #978 merges — it introduces the classed-row scheme and the completeness
  detector this builds on. Not blocking otherwise.

## Risks

- Format changes here ripple to two stub harnesses; see Implementation Notes.
- Over-tightening the count check would turn ordinary PRs into exit 2, which reaches the merge gate
  as "review required" and would be read as the gate being broken.

## Updates

### 2026-09-16

- Filed from the PR #978 security review, measured with a two-sided pair.
