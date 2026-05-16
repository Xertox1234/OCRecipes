---
title: "kimi pre-commit hook false-blocks commits with a phantom CRITICAL finding"
status: backlog
priority: low
created: 2026-05-15
updated: 2026-05-15
assignee:
labels: [tooling, kimi]
github_issue:
---

# kimi pre-commit hook false-blocks commits with a phantom CRITICAL

## Summary

The Claude-Code kimi-review pre-commit gate intermittently blocks a commit
with "kimi-review blocked the commit — CRITICAL finding present" when the
review verdict is actually clean. The blocked output shows either an empty
`[CRITICAL]` body or the literal text "No CRITICAL or WARNING findings". A
plain retry of the same commit succeeds.

## Background

Observed twice on 2026-05-15 in a single session:

1. Commit of `vitest.config.ts` (8-line config change) — blocked with an
   empty `[CRITICAL]` / `[WARNING]` body. Manual `kimi-review` re-run on the
   identical staged diff returned "No findings". Retry of the commit succeeded.
2. Commit of two `.md` docs files — blocked with "CRITICAL finding present",
   but the review text printed "No CRITICAL or WARNING findings". Retry
   succeeded.

Token-count signal: the _first_ (uncached) review call is the one that
mis-triggers; the retry hits a cached review (`6400 cached` / `2400 cached`
tokens) and parses clean. This points to the hook's CRITICAL-detection
mis-parsing the uncached response — most likely a substring match on the
token `CRITICAL` that also fires inside the negative phrase "No CRITICAL or
WARNING findings", or on streamed/partial first-run output.

## Acceptance Criteria

- [ ] Identify where the gate decides "CRITICAL present" — the in-repo hook
      script wired in `.claude/settings.json` (PreToolUse on `git commit`)
      and/or the `kimi-review` script itself.
- [ ] The detection must not match the negative phrase "No CRITICAL ... findings"
      nor an empty `[CRITICAL]` section — require an actual finding body.
- [ ] A docs-only or clean diff commits on the first attempt with no false block.
- [ ] Real CRITICAL findings still block (regression-check with a known-bad diff).

## Implementation Notes

- The block message wording ("kimi-review blocked the commit — CRITICAL
  finding present") originates from the hook glue, not git. Start at
  `.claude/settings.json` → the `git commit` PreToolUse hook and whatever
  script it invokes.
- Likely fix: parse for a `[CRITICAL]` tag _followed by non-empty content on
  the next line(s)_, rather than a bare `grep -q CRITICAL`. Anchor the match
  so "No CRITICAL or WARNING findings" cannot satisfy it.
- `kimi-review` itself lives at `~/.local/bin/kimi-review` (out-of-repo) — if
  the malformed first-run output comes from there, that part of the fix is a
  personal-tooling change (cf. `todos/archive/2026-05-11-kimi-timeout-error-handling.md`).

## Dependencies

- None.

## Risks

- Low. Worst case today is an occasional false block cleared by a retry; no
  bad code is let through. The fix must preserve true-CRITICAL blocking.

## Updates

### 2026-05-15

- Created after two false blocks in one session (vitest.config.ts commit and
  a docs commit). Both cleared on retry.
