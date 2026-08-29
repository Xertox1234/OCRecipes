---
title: "cmd_bare/cmd_words treat quoted \$(...) and backtick command substitution as inert data"
status: backlog
priority: high
created: 2026-08-17
updated: 2026-08-17
assignee:
labels: [security, harness]
github_issue:
---

# cmd_bare/cmd_words treat quoted \$(...) and backtick command substitution as inert data

## Summary

Neither `cmd_bare` nor `cmd_words` (`.claude/hooks/lib/cmd-detect.sh`) special-cases
`$(...)`/backtick command substitution: content inside a double-quoted (or backtick)
span is blanked/neutralized like any other quoted data, even though bash always
**executes** `$(...)`/backticks regardless of surrounding quotes. This lets a real,
executing outward-facing command hide from every guard by wrapping it in ordinary
double quotes — no exotic quoting trick required.

## Background

Surfaced during the `/code-review` follow-up pass on PR #850
(`fix/cmd-words-quoting-bypass`), 2026-08-17, and empirically reproduced by piping
crafted tool-call JSON into the live hook scripts:

- `echo "$(eas update --branch preview --platform all)"` → `guard-outward-cli.sh`
  returns exit 0, no deny. This is a REAL, WORKING bash command that publishes a live
  OTA update via the embedded command substitution. Control: the unquoted form
  `eas update --branch preview --platform all` is correctly denied by the same hook,
  confirming the gap is specifically the quoting, not a missing pattern.
- `echo "$(gh pr merge --admin 42)"` and `echo "$(gh api -X POST repos/o/r/merges)"` —
  both verified to return exit 0 / no deny, both real, executing GitHub API mutations
  (bypassing the `--admin` carve-out check and the mutating-HTTP-method check
  respectively).
- `echo "$(gh pr create --fill)"` — verified to return exit 0 (allowed), no
  preflight-stamp gate JSON emitted, versus the bare form which correctly triggers the
  gate.

**Mechanism**: inside `cmd_words`'s quote-state scan, `neutral()` (the set of
characters a quoted span turns into placeholders) includes `(`, `)`, backtick, and
whitespace — so `"$(eas update ...)"` collapses to a single opaque placeholder-laden
token instead of being recognized as "this text is executed regardless of the quotes
around it." `cmd_bare` has the same blind spot (it blanks the whole span, substitution
included).

**Severity note, why this is arguably the most severe finding of the whole review
round**: it needs no crafting beyond ordinary double quotes (not an ANSI-C `$'...'`
trick, not a mid-word empty span) and grants full command EXECUTION bypass of the
deny gate, not just detection evasion of a matcher.

**Not introduced by PR #850** — confirmed the identical bypass exists on `main` before
that branch (same `echo "$(eas update ...)"` input, same exit 0). This is a
pre-existing, structural gap in the whole quote-scanning approach, not a regression.

## Acceptance Criteria

- [x] Design decision made and documented: **(c) adopt a different detection
      mechanism entirely** — decided by the user 2026-08-29 (see Updates). Evaluate
      delegating to a real shell tokenizer (e.g. bash's own parser in a restricted
      subshell) instead of extending `cmd_bare`/`cmd_words`'s hand-rolled awk
      quote-scanner with an 8th special case.
- [ ] All four reproduction cases above (`eas update`, `gh pr merge --admin`,
      `gh api -X POST`, `gh pr create`) correctly deny/gate after the fix.
- [ ] Regression tests added to `test-cmd-detect.sh` and the relevant end-to-end
      `test-*.sh` files, piping the exact reproduction strings into the live hooks.
- [ ] Full `scripts/run-hook-tests.sh` suite still passes.

## Implementation Notes

This is the specific instance the reviewer's "altitude" finding flagged as a systemic
concern: this branch's own commit history shows SIX separate CRITICAL bypasses found
and closed one at a time, each by adding another special case to the hand-rolled awk
quote-scanning state machine (`ANSI-C quoting → escaped-space → NAME=value splitting →
empty-span → $-sigil → argv-word-boundary`). This finding (command substitution) may be
bypass #7 in that same pattern, or it may be the signal to step back: a real shell
tokenizer (e.g. `bash -c 'read -a words <<<"$CMD"'` under careful sandboxing, or
delegating to bash's own parser in a restricted subshell) would get quoting, escaping,
ANSI-C quoting, AND command-substitution-always-executes semantics for free, closing
this entire CLASS of bug rather than one variant per review round. Worth evaluating
that architectural option explicitly before adding a 7th special case to the awk model
— this todo's scope intentionally leaves that evaluation open rather than presupposing
another awk patch is the right fix.

## Scope Contract

<!-- Decision made 2026-08-29 (see Updates): option (c), a real shell tokenizer. The
     first step of implementation should still be a design/spike evaluating the
     specific tokenizer approach before committing to line-by-line hook changes. -->

- **Mechanisms to use:** a real shell tokenizer (e.g. bash's own parser invoked in a
  restricted subshell) to replace `cmd_bare`/`cmd_words`'s awk-based quote-scanning,
  rather than adding another special case to the existing state machine.
- **Files in scope:** `.claude/hooks/lib/cmd-detect.sh` and every hook that consumes
  `cmd_bare`/`cmd_words` (`.claude/hooks/{guard-outward-cli,pr-preflight-guard,
branch-preflight,commit-verify,core-bare-guard,drift-detect,drift-detect-update,
pr-verify}.sh`), plus their test files.

## Dependencies

- None. Independent of `todos/P1-2026-08-17-cmd-position-anchor-boundary-gaps.md`
  (same review round, different root cause).

## Risks

- This is a structural change to the core detection mechanism, not a narrow bugfix —
  budget real design time, not a quick patch. A rushed fix here has historically
  (per this same PR's commit history) introduced a NEW bypass while closing the old
  one.

## Updates

### 2026-08-17

- Filed from the PR #850 `/code-review` follow-up pass, per user decision to file
  pre-existing repo-wide gaps for a dedicated session rather than expand this PR's scope.

### 2026-08-29

- A `/todo` orchestrator run flagged this todo as structurally undecided-architecture-
  on-a-security-deny-gate (the same shape as the already-`human_led`-gated sibling
  `P3-2026-08-16-command-guards-fire-on-heredoc-prose.md`) and, rather than dispatching
  it unattended, surfaced the choice to the user directly. **Decision: (c) — replace
  the detection mechanism.** Evaluate delegating to a real shell tokenizer instead of
  extending the awk quote-scanner with an 8th special case. Not implemented in this
  session — this is a P1 security fix with a genuinely open-ended first step (a
  design/spike, per the todo's own Risks section), and deserves a dedicated,
  full-context session (recommended: `/todo-fast` given its priority) rather than being
  squeezed into a batch run's tail end.
