---
title: "Structural PreToolUse deny for outward-facing CLIs (eas/railway/npm publish/mutating gh)"
status: done
priority: medium
created: 2026-08-16
updated: 2026-08-16
assignee:
labels: [deferred, security, harness]
github_issue:
---

# Structural PreToolUse deny for outward-facing CLIs (eas/railway/npm publish/mutating gh)

## Summary

The only control added against a repeat of the 2026-08-16 accidental-OTA incident is prose (a `code-reviewer.md` contract rule + a conventions doc). Prose can be skipped by a dispatch prompt that omits it or an agent that doesn't attend to it — the incident doc itself notes the main-loop classifier "does not always fire inside subagents." Add a structural PreToolUse Bash deny for outward-facing CLI invocations.

## Background

Filed from PR #827's review, which applied the conventions doc's own "could the assertion become false without anything failing?" test to the prose mitigation and answered yes. The repo already has quote-aware command-position matching in `.claude/hooks/lib/cmd-detect.sh` and precedent for PreToolUse deny hooks (worktree-contract guards). Weigh against the ~60-75ms/9-hooks per-Bash overhead memory before adding another hook — possibly fold into an existing guard rather than a new file.

## Acceptance Criteria

- [x] PreToolUse Bash hook DENIES command-position `eas update|publish|submit`, `railway up|redeploy|...` (mutating verbs), `npm publish`, and mutating `gh` subcommands (`pr merge`, `release create`, …) unless an explicit env escape (e.g. `ALLOW_OUTWARD_CLI=1`) is set
- [x] Read-only subcommands (`eas update:list`, `gh pr view/checks`, `railway status/logs`) remain allowed
- [x] Hook self-tests in `.claude/hooks/test-*.sh` cover deny-fires and allow-passes (two-sided), discovered by `scripts/run-hook-tests.sh`
- [x] `docs/solutions/conventions/never-execute-an-outward-facing-cli-fragment-in-review-2026-08-16.md` updated to note the structural layer

## Implementation Notes

Anchor extraction to the command position via `cmd-detect.sh` (see the command-gate option-cardinality solution doc for the bypass classes to avoid). Keep the deny list short and verb-scoped — the goal is stopping channel/registry/repo mutations, not blocking reads. `gh pr comment`/`gh pr create` are judgment calls: they are outward but routine; decide with the human at implementation time.

## Scope Contract

- **Mechanisms to use:** existing PreToolUse hook wiring + `cmd-detect.sh`; `scripts/run-hook-tests.sh` for tests.
- **Files in scope:** `.claude/hooks/**`, `.claude/settings.json` (hook registration), the conventions doc noted above.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- PR #827 merged (the conventions doc this hardens).

## Risks

- Per-Bash hook overhead (~60-75ms across 9 hooks today) — measure before/after; prefer folding into an existing guard.
- Over-broad matching could block legitimate read-only diagnostics mid-incident.

## Updates

### 2026-08-16

- Initial creation from PR #827 review (structural-vs-prose mitigation question).

### 2026-08-16 (implementation)

- Implemented as a new file `.claude/hooks/guard-outward-cli.sh` rather than
  folding into `git-safety.sh`: its DENY branch must fire unconditionally,
  while `git-safety.sh`'s CONTRACT branch is gated behind an active
  worktree-contract registry — a different activation condition. Measured
  ~8.75ms/invocation on the fast (non-matching) path, in line with the
  lightweight existing hooks.
- Two review rounds (code-reviewer + security-auditor each round) found and
  fixed 3 CRITICAL gaps in round 1 (an --auto carve-out bypass via a
  value-flag decoy, plus after round 1's own fixes: unprotected `eas
update:*` mutating colon subcommands, unprotected `railway
variable/service/environment` sub-subcommands, and a fail-OPEN bug when
  `lib/cmd-detect.sh` is unsourceable) and 4 more CRITICALs in round 2 (the
  `--admin` and `gh api` method checks each missed the `=value` and
  glued/quoted spellings of the flag they were meant to gate, plus a
  multi-clause `gh api` shadowing gap). All are fixed and covered by
  regression tests; final suite is 54/54.
- **Two judgment calls made autonomously** (the todo's Implementation Notes
  said "decide with the human at implementation time" for `gh pr
create`/`comment`; no human was in the loop during automated execution) —
  flagging for ratification at PR review: (1) bare `gh pr merge` DENIES, but
  `gh pr merge --auto ...` (without `--admin`) stays ALLOWED because it arms
  GitHub's native auto-merge rather than mutating synchronously, and this
  repo's own `/todo` automerge pipeline depends on exactly that form; (2)
  `gh pr create`/`gh pr comment` stay ALLOWED per the todo's own carve-out.
- **Process note:** a round-1 `code-reviewer` subagent verified subcommand
  claims by running `eas update --help`/`railway --help`/`gh pr merge
--help` against the real installed binaries. No mutating command ran and
  nothing was published/merged/deleted, but this is the exact pattern
  `docs/solutions/conventions/never-execute-an-outward-facing-cli-fragment-in-review-2026-08-16.md`
  prohibits — the "never execute" constraint was stated explicitly in this
  session's `security-auditor` dispatch but not in its `code-reviewer`
  dispatch. Round 2 restated it in both. Codified as a recurrence in that
  same doc (a code-reviewer's default instinct is to verify a claim with
  `--help`, so the prohibition needs restating in every dispatch touching
  this domain, not only the one that "looks risky").
- Scope Contract honored throughout: only `.claude/hooks/guard-outward-cli.sh`
  (new), `.claude/hooks/test-guard-outward-cli.sh` (new),
  `.claude/settings.json` (hook registration), and the named conventions doc
  were touched — no new mechanism.
