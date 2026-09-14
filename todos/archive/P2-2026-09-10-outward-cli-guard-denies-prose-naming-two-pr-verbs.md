---
title: "The outward-CLI guard denies ordinary prose that names two PR verbs, and its advice is unactionable for the text-only case"
status: done
priority: medium
created: 2026-09-10
updated: 2026-09-10
assignee:
labels: [deferred, harness]
github_issue:
---

# Documentation prose naming two PR verbs is denied as if it were two commands

## Summary

`cmd_gh_pr_write_subcommand` reads **command text**, so any Bash-tool call whose text
mentions two PR write-verbs — a heredoc, a commit message, a JSON test fixture, a ledger
entry — trips the ambiguity REFUSE and is denied before it runs. Nothing is executed and
nothing can be split, but the deny advises _"Split it into one `gh pr` call per command and
re-run"_, which is not merely unhelpful — it is **factually wrong for the text-only case**.

Three independent hits in a single session (2026-09-10), all on legitimate work:

1. A ledger append whose prose named one CLI twice.
2. A ledger append whose prose named the merge verb twice.
3. An implementer's `python3` heredoc whose body contained both verbs — and, separately,
   the reviewer auditing that implementer hit the same trap while constructing JSON
   fixtures, and rerouted through `sed`-against-files.

Two agents plus this session, on ordinary work, in a few hours. That is a frequency signal
rather than an anecdote.

## Background

Discovered during the merge-review-gate build (`docs/superpowers/plans/2026-09-09-merge-review-gate.md`).
Every occurrence was worked around by routing the write through a file (`Write`/`Edit`)
instead of a single Bash argument. **Nobody reached for `ALLOW_OUTWARD_CLI=1`**, which is
the correct instinct and worth preserving: the moment bypassing becomes reflex, the gate is
decorative.

### Do NOT "fix" this by narrowing the detector

The function must see inside comments and quotes precisely because that is where a decoy
lives — `echo "$(gh pr merge 42)" # gh pr create` is the mutation the corpus already pins.
Narrowing detection to exclude quoted or commented text reopens a real bypass. This is the
inverse of the "guard lexer needs matching redaction" pattern, not an instance of it.

## Acceptance Criteria

- [ ] The deny message distinguishes **two executable occurrences** from **one command whose
      text merely mentions the verbs twice**, and its advice is actionable in both cases
      (for the text-only case: write the content through a file tool rather than a single
      Bash argument)
- [ ] The change lands in the shared library, or is applied consistently to **both** callers —
      `.claude/hooks/merge-review-guard.sh:110` and `.claude/hooks/pr-verify.sh:27`
- [ ] The decoy corpus still denies: `echo "$(gh pr merge 42)" # gh pr create` and its
      variants remain DENIED, mutation-verified
- [ ] `.claude/hooks/repro-outward-cli-corpus.sh` still pins at its current row count, and
      any row-count change is deliberate and explained
- [ ] Closes with zero follow-ups

## Implementation Notes

- `.claude/hooks/**` feeds the `Outward-CLI guard corpus` required check on `main`. A
  careless edit wedges every PR — mutation-verify before pushing.
- Both callers must be considered together; widening or rewording a detector in one consumer
  and not the other is the documented failure mode (`MEMORY.md` → "Widen a detector and its
  consumers in ONE change").
- The cheapest safe mitigation is already proven and costs nothing: construct text naming two
  PR verbs via file writes, never as a single Bash-tool argument. If the message fix turns out
  to be the whole remedy, record that mitigation in the message itself.

## Scope Contract

- **Mechanisms to use:** a message/classification change in the existing detector or its
  wrapper — no new hook, no new file, no change to what is DENIED
- **Files in scope:** `.claude/hooks/lib/cmd-detect.sh` (or the two callers named above), plus
  the corpus/test files that pin them
- No new mechanisms, files, or abstractions beyond those listed.

## Risks

- **Narrowing detection to reduce false positives reopens the decoy bypass.** The acceptance
  criteria pin this deliberately: what is DENIED must not change, only how it is explained.
- A row-count change in the corpus pin is a signal, not a nuisance — investigate rather than
  re-pin to green.

## Updates

### 2026-09-10

- Filed during the merge-review-gate build after three independent occurrences in one session.
  Severity Medium: fail-closed, no correctness impact, but it costs real work on every hit and
  its advice actively misleads for the text-only case.

### 2026-09-14

- Resolved in `.claude/hooks/merge-review-guard.sh`'s REFUSE branch (line ~120). Composed a
  local classifier from `cmd_is_gh_pr_create`'s own existing primitives (`_CMD_POS_PREFIX`,
  `_CMD_GH_GLOBALS`, `_CMD_POS_SUFFIX`, `cmd_words_deep`) at the call site — no new detector,
  no widening of `cmd_gh_pr_write_subcommand`/`cmd_bare_deep`. Verdict is unchanged (both
  sub-cases still deny); only the message differs, and honestly, per sub-case. `pr-verify.sh`
  needed no change — it already degrades to silent (empty output) on this same REFUSE, so
  there was nothing there to make consistent. Verified by constructing both repro shapes and
  a negative control against a fake-`gh` harness, and by a genuine pre-fix-vs-patched
  side-by-side comparison (all 8 cells DENY; message differs only for the text-only case).
  `test-merge-review-guard.sh`: 86/86 (added rows 33/33b/33c). Canonical hook-test runner
  (`scripts/run-hook-tests.sh`): 37/37. Outward-CLI corpus (`repro-outward-cli-corpus.sh`,
  untouched by this diff): rows=602, all-path gaps=243, deny-attribution=504 — matches the
  base pins exactly.
- One residual surfaced and deliberately left open, per Scope Contract (no new mechanism): a
  heredoc body line whose write-verb sits at column 0 with no leading prose still gets the
  old "split it" message (verdict still deny) — documented in the code comment and pinned as
  a tripwire row (33c) so a future change to close it is a visible, deliberate decision, not
  a silent one. Not a follow-up todo — closes with zero.
