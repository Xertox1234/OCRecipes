---
title: "The outward-CLI guard denies ordinary prose that names two PR verbs, and its advice is unactionable for the text-only case"
status: backlog
priority: medium
created: 2026-09-10
updated: 2026-09-20
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

## Prior implementation — harvested from an abandoned branch, 2026-09-20

A complete, reviewed implementation of this todo existed on
`todo/P2-2026-09-10-outward-cli-guard-denies-prose-naming-two-pr-verbs` (tip `41931831`, four
commits). It never got a PR, went stale, and the branch was deleted on 2026-09-20. **The design
and the measurements below are its findings, preserved so the next attempt starts from them
rather than rediscovering them — but every measurement must be RE-DERIVED, for the reason in
"What invalidated it" below.**

### The design that worked

Compose a local classifier **at the REFUSE site** (`merge-review-guard.sh`, the
`SUB_RC -ne 0` branch) from `cmd_is_gh_pr_create`'s own existing primitives —
`_CMD_POS_PREFIX`, `_CMD_GH_GLOBALS`, `_CMD_POS_SUFFIX`, `cmd_words_deep`. Critically: **not** a
new detector, and **no** widening of `cmd_gh_pr_write_subcommand` / `cmd_bare_deep`, which stay
exactly as they are. That respects this todo's "do NOT fix this by narrowing the detector"
section — the verdict is unchanged (both sub-cases still `deny`); only the message differs.

Fail-safe default: an uncertain read (capture failure) keeps the ORIGINAL message, rather than
risking a false "nothing executes" claim.

`pr-verify.sh`, this todo's other named caller, needed no change — it already degrades to empty
output on this same REFUSE, so there was nothing to make consistent.

### The measured residuals, and why each was left open

A heredoc body line whose write-verb sits at **column 0 with no leading prose** still matches
command position under this repo's grep-per-line anchor semantics, so it keeps the pre-fix
message even though nothing executes. Verdict stays `deny` either way, so the direction is safe.
Closing it needs real heredoc-boundary parsing, which is outside this todo's Scope Contract.

The branch pinned that residual as a **tripwire test row** rather than leaving it as a comment,
on the principle that a measurement written only in a comment is not a guard: if a future change
closes the gap, the row flips and forces an explicit decision instead of letting the improvement
land silently. Reproduce that when reimplementing.

**Residual (2) — a QUOTED heredoc delimiter.** `<<'EOF'` suppresses all expansion in its body, but
the shared, unmodified `cmd_extract_substitutions` has no heredoc-redirection semantics and still
reports an embedded `$(gh pr merge …)` as live — so the body gets the same stale "split it" message
even though nothing executes. Confirmed on the branch by construction: a quoted-delimiter body and
its unquoted control returned the identical message, though only the control genuinely executes.
Verdict unaffected (still `deny`) in both.

It was deliberately **not** given its own pinned row, and the reason matters: it produces the same
message text rows 33/33b already assert, so a dedicated row would only re-assert an identical
string. That is a real argument, not an oversight — but if a future change makes the two messages
differ, it becomes worth pinning.

**These are two independent mechanisms, not one gap described twice.** Both are library-level
extraction gaps (`cmd_extract_substitutions` / `cmd_words`), not failures of the call site's own
classification logic — which is why closing either one would mean widening the shared extractor,
outside this todo's Scope Contract.

### What invalidated it — read before reusing any number

`_CMD_GH_GLOBALS` was **widened** after that branch was cut, by **#957** (`c96e22fd`), to accept
value-taking flags (`-x value`) — its generic flag arm gained an optional trailing
`([[:space:]]+[^-[:space:]][^[:space:]]*)?` group. Attribution checked with `git log -S` on that
added text, which returns exactly that one commit; #995 touches `.claude/hooks/lib/cmd-detect.sh`
zero times, and its `merge-review-guard.sh` changes land in the `gh api` implicit-POST arm, not
the REFUSE region this classifier touches. The classifier above is composed FROM that primitive, so its behaviour has
changed underneath the design even though the code still merges cleanly — a textual merge with no
conflict marker, over semantics that moved. Every probe result the branch recorded must therefore
be re-run, not inherited.

Two concrete stale figures: the branch ended at `EXPECTED_TOTAL=86` in
`test-merge-review-guard.sh`, where `main` is now at **179**; and its corpus pins
(`rows=602, all-path gaps=243, deny-attribution=504`) predate several guard changes. Re-derive
both.

### Still live

`main`'s REFUSE message is unchanged — the wrong advice ("Split it into one `gh pr` call per
command and re-run") is present verbatim, so this todo has not been overtaken by any later PR.

## Updates

### 2026-09-10

- Filed during the merge-review-gate build after three independent occurrences in one session.
  Severity Medium: fail-closed, no correctness impact, but it costs real work on every hit and
  its advice actively misleads for the text-only case.

### 2026-09-20

- A finished implementation of this todo was found on an abandoned branch that never got a PR.
  Rather than rebase it — its composed classifier reads a primitive (`_CMD_GH_GLOBALS`) that has
  since been widened, so its verification would have had to be re-derived regardless — its design,
  its measured residual and its stale figures were harvested into the section above and the branch
  was deleted. Confirmed before deleting that the defect is still live on `main`.
