---
title: "guard-outward-cli.sh: avoid forking awk twice on every fast-path hit"
status: backlog
priority: low
created: 2026-08-16
updated: 2026-08-16
assignee:
labels: [deferred, harness]
github_issue:
---

# guard-outward-cli.sh: avoid forking awk twice on every fast-path hit

## Summary

`BARE=$(... | cmd_bare)` and `WORDS=$(... | cmd_words)` both run unconditionally once
the fast path matches, forking `awk` twice per invocation — but `$BARE` is used only by
the single blank-rendering fallback check further down.

## Background

Surfaced in the `/code-review` of PR #850. This hook runs on every Bash tool call and
its fast path matches on the bare substrings `npm`/`gh`/`eas`/`railway`/`yarn` — a large
fraction of ordinary dev commands (`npm test`, `npm install`, `git log --grep npm`, any
command piped through `gh`). Each of those pays two `awk` subprocess forks instead of
one, on exactly the hot path `project_per_bash_hook_overhead` (memory) flags as
budget-constrained (~60-75ms/9 hooks).

## Acceptance Criteria

- [ ] `$BARE` is computed lazily (only when the blank-rendering fallback check actually
      needs it) or the two computations are otherwise collapsed to one `awk` fork.
- [ ] The blank-rendering fallback's behavior (degrade to the crude smell test when
      $BARE or $WORDS renders blank from a non-blank $CMD) is unchanged — existing
      `test-guard-outward-cli.sh` assertions for this stay green.
- [ ] Benchmark the fast-path hot path before/after (per-invocation wall time on a
      representative command).

## Implementation Notes

`cmd_bare` and `cmd_words` share the same awk backend/quote-scan logic — a single-pass
awk program emitting BOTH renderings (rather than two separate `awk` invocations) may be
the cleanest fix, but changes the shared `lib/cmd-detect.sh` surface other hooks also
call — verify no other caller depends on `cmd_bare`/`cmd_words` being independently
invocable.

## Scope Contract

- **Mechanisms to use:** either lazy evaluation in `guard-outward-cli.sh` or a combined
  single-awk-pass helper in `lib/cmd-detect.sh`.
- **Files in scope:** `.claude/hooks/guard-outward-cli.sh`, possibly `.claude/hooks/lib/cmd-detect.sh`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- A combined single-pass rendering changes a shared lib function other hooks
  (`pr-verify.sh` via `cmd_gh_pr_write_subcommand`/`cmd_gh_pr_ref`, which read
  `cmd_bare` only) also call — must not change their output.

## Updates

### 2026-08-16

- Filed from the PR #850 `/code-review` reuse/efficiency findings.
