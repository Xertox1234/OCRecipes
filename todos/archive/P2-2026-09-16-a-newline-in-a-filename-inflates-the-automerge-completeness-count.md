---
title: "A newline inside a filename forges an extra destination row in todo-automerge-guard — it inflates the completeness count AND satisfies the TODO GATE with an archive file that is not in the diff"
status: done
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

- [x] The completeness count no longer derives from flattened text. **Amended by review** (see
      Scope Contract and Updates below): the originally-preferred fix — the SAME jq pass emitting
      one count row ahead of the file rows (`"N \(length)"`) and requiring the F count to equal it
      — is necessary but, on its own, NOT sufficient: a single crafted filename can embed both a
      forged `F ` row AND a forged, compensating `N ` row in the same newline-delimited payload, so
      an N-row-only implementation can be made to balance (`total_N == raw F count`) while still
      carrying the forged row through to the TODO GATE / PATH GATE (constructed and run by the
      code-reviewer round; see Updates). The shipped fix instead refuses (`B` sentinel) any
      `.filename`/`.previous_filename` containing a literal newline AT THE JSON LEVEL, in the same
      jq pass, before any text-flattening — so no forged row of ANY kind (real, self-classing, or
      count-compensating) is ever emitted. The N-row structural check is kept as a second,
      independent cross-check (comparing the RAW, non-deduped F count to `N` — see Updates for why
      raw rather than distinct), but is not itself the mechanism that closes the hole.
- [x] A regression row pinning the forged-row case: injected tail with declared count high, assert
      exit 2 and assert the **diagnostic**, not just the code — three separate arms in this script
      exit 2, so a bare status check cannot attribute the failure.
- [x] A must-still-pass control in the same run: ordinary rows with an agreeing declared count are
      gated normally, so the ERROR is attributable to the forged row.
- [x] **The TODO GATE's read of `files` is covered too.** Corrected claim (see Updates): the
      N-row-only fix does NOT do "nothing" about the forged-archive flip — a single, non-compensating
      forged `F todos/archive/...` tail is in fact caught by an N-vs-F mismatch alone. What an
      N-row-only fix cannot catch is the compensating-row variant above, which is why the TODO GATE
      needed the SAME `B` sentinel, not a second, separate mechanism. Pinned with a dedicated row.
- [x] Mutation-verified: with the fix reverted, the new rows go RED. An arm that cannot fail pins
      nothing. Additionally mutation-verified against a B-less mutant (jq filter's `if` branch
      short-circuited to always take the `else` path) to prove the `B` sentinel specifically, not
      just the `N`-count check, is load-bearing — see Updates.

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

**Amended post-implementation, by code-reviewer finding** (see Updates 2026-09-20): the original
text below named only the N-row/completeness-comparison mechanism. That mechanism alone is
measurably bypassable (a single filename can forge both an `F ` row and a compensating `N ` row in
the same payload — see Updates), so the shipped fix also needed a second refusal arm. This
amendment records that widening explicitly rather than leaving it an unflagged deviation.

- **Mechanisms to use:** the existing jq emission — widened, IN THE SAME jq pass, to test
  `.filename`/`.previous_filename` for an embedded literal newline while each is still a
  structured JSON string (before any text-flattening), and refuse (a new `B` sentinel row, styled
  on the pre-existing `X` idiom) the item's `F`/`P`/`X` emission entirely when one is found — plus
  the existing completeness comparison (unchanged), plus one new, parallel structural check: a
  jq-emitted `N <length>` row per page, summed across pages, compared against the RAW (non-deduped)
  `F` row count. No new API call, no new file.
- **One new bash refusal arm** (`B`, mirroring the existing `X` arm exactly) and **one new
  structural comparison block** are added beyond the original "reuse only" framing — both are
  necessary (see Updates for the adversarial construction proving the N-row-only design
  insufficient) and both stay inside the SAME jq pass / SAME three files; no new API call, gate
  _category_, or file was introduced beyond widening the two named mechanisms.
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

### 2026-09-20

- Implemented, then amended by the code-reviewer round (Scope Contract CRITICAL — see above).
  During implementation, the executor independently constructed the same class of adversarial
  input to test the AC's literal "N-row + count-equality" design: a single filename embedding a
  forged `F ` row AND a forged, compensating `N ` row (e.g.
  `"client/a.ts\nF client/b.ts\nN 1"`). Run against a hand-built filter matching the AC's literal
  text (no `B` branch), this input balances `total_N == raw F count` while the forged row still
  reaches the TODO GATE / PATH GATE — an N-row-only implementation is bypassable. The
  code-reviewer round independently re-ran the identical construction against a hand-built
  AC-literal filter and confirmed the same result (`total_N=3, raw_F_count=3`, forged row still
  delivered), and flagged the resulting `B` sentinel + parallel N-check as a Scope Contract
  deviation (CRITICAL) needing to be recorded rather than silently shipped — hence this amendment.
- Correction to this todo's own AC #4 claim: the N-row-only fix does **not** do "nothing" about the
  forged-archive-tail flip — a single, non-compensating forged `F todos/archive/...` tail (no
  accompanying forged `N ` row) IS caught by an N-vs-F mismatch alone (measured: `N=1,
raw_F=2` → mismatch). What an N-row-only fix cannot catch is specifically the
  compensating-row variant above. The `B` sentinel closes both the simple and the compensating
  case uniformly, at the root, by refusing any newline-bearing name before any `F`/`N` text is
  ever emitted for it.
- Mutation-verified against a `B`-less mutant (the jq filter's `if ... then "B" else ...` branch
  short-circuited to always take the `else` path, i.e. equivalent to an N-row-only implementation):
  the existing single-forged-tail regression rows (completeness-count case, forged-archive case)
  still correctly go RED under this mutant too — they don't yet discriminate "the shipped fix" from
  "N-row alone" — so a dedicated compensating-row regression test was added
  (`scripts/__tests__/todo-automerge-guard.test.ts`, describe block "a filename that forges BOTH a
  self-classing row AND a compensating count row cannot survive the B sentinel") that only passes
  under the real, shipped filter and goes RED under the `B`-less mutant, closing the code-reviewer's
  WARNING finding.
