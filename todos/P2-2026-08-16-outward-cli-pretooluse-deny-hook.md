---
title: "Structural PreToolUse deny for outward-facing CLIs (eas/railway/npm publish/mutating gh)"
status: backlog
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

- [ ] PreToolUse Bash hook DENIES command-position `eas update|publish|submit`, `railway up|redeploy|...` (mutating verbs), `npm publish`, and mutating `gh` subcommands (`pr merge`, `release create`, …) unless an explicit env escape (e.g. `ALLOW_OUTWARD_CLI=1`) is set
- [ ] Read-only subcommands (`eas update:list`, `gh pr view/checks`, `railway status/logs`) remain allowed
- [ ] Hook self-tests in `.claude/hooks/test-*.sh` cover deny-fires and allow-passes (two-sided), discovered by `scripts/run-hook-tests.sh`
- [ ] `docs/solutions/conventions/never-execute-an-outward-facing-cli-fragment-in-review-2026-08-16.md` updated to note the structural layer

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
