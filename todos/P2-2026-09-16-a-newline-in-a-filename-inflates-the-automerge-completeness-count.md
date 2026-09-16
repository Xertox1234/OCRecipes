---
title: "A newline inside a filename forges an extra destination row, inflating todo-automerge-guard's completeness count and masking a truncated file"
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
normally** (it lands in `files` and goes through the PATH GATE), so this is not a route to
sneaking a protected path through. The damage is only to the completeness count.

## Background

Reaching it needs BOTH a tracked filename carrying a literal newline AND simultaneous server-side
truncation of the `pulls/{n}/files` endpoint. Neither is reachable in ordinary use, which is why
this is hardening rather than a live bypass. It matters because of the consumer:
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
- [ ] Mutation-verified: with the fix reverted, the new row goes RED. An arm that cannot fail pins
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
